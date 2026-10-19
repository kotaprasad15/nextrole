"""Single-agent baseline: one prompt turns (profile, job) into an outreach email.

Design decision: this is the control for the evaluation. It gets the same inputs as the
multi-agent pipeline's Writer minus research, tiering, grounding facts and the Critic loop,
so any quality/factuality gap can be attributed to the multi-agent structure.
"""
from pydantic import BaseModel

from nextrole.llm.client import LLMClient
from nextrole.models.job import Job
from nextrole.models.outreach import OutreachDraft
from nextrole.models.profile import Profile

SYSTEM = (
    "You write concise, personalized cold outreach emails for job seekers (under 150 words). "
    "Use only facts present in the candidate profile and job posting provided. "
    "Do not include any URLs. Do not invent facts."
)


class _Reply(BaseModel):
    subject: str
    body: str


async def run_baseline(llm: LLMClient, model: str, profile: Profile, job: Job) -> OutreachDraft:
    user = (
        f"CANDIDATE PROFILE:\n{profile.model_dump_json(indent=1)}\n\n"
        f"JOB: {job.title} at {job.company} ({job.location})\n{job.description[:3000]}"
    )
    reply = await llm.complete_json(
        agent="baseline", model=model, system=SYSTEM, user=user, schema=_Reply, max_tokens=600
    )
    return OutreachDraft(job_id=job.id, subject=reply.subject, body=reply.body)
