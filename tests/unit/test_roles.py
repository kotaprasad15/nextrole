"""Role taxonomy: synonyms, seniority, related roles, custom roles, and its use in discovery and ranking."""
import pytest

from nextrole.agents.matcher import prefilter
from nextrole.models.job import Job
from nextrole.models.profile import Preferences, Profile
from nextrole.roles.taxonomy import canonicalize, resolve, role_matches, roles_match
from nextrole.sources.registry import matches


@pytest.mark.parametrize(
    ("text", "canonical"),
    [
        ("SDE", "software_engineer"), ("SDE II", "software_engineer"), ("Software Engineer", "software_engineer"),
        ("Sr. Software Development Engineer", "software_engineer"), ("Member of Technical Staff", "software_engineer"),
        ("FDE", "forward_deployed_engineer"), ("Forward Deployed Engineer", "forward_deployed_engineer"),
        ("Senior Forward-Deployed Software Engineer", "forward_deployed_engineer"),
        ("Back-end Engineer", "backend_engineer"), ("Staff Backend Developer", "backend_engineer"),
        ("Full Stack Developer", "fullstack_engineer"), ("MLE", "ml_engineer"), ("Site Reliability Engineer", "sre"),
        ("Software Development Engineer in Test", "qa_engineer"), ("Product Manager", "product_manager"),
        ("Software Engineering Manager", "engineering_manager"),
    ],
)
def test_synonyms_and_seniority_resolve_to_one_canonical_role(text, canonical):
    assert canonicalize(text) == canonical


def test_unknown_text_has_no_canonical_role():
    assert canonicalize("Growth Marketer") is None and canonicalize("") is None


@pytest.mark.parametrize(
    ("title", "wanted", "expected"),
    [
        ("Software Development Engineer II", "SDE", True),
        ("Software Engineer, Payments", "SDE", True),
        ("Member of Technical Staff", "Software Engineer", True),
        ("Forward Deployed Software Engineer", "FDE", True),
        ("Backend Engineer", "Software Engineer", True),     # a backend role is a software role...
        ("Software Engineer", "Backend Engineer", False),    # ...but not the other way round
        ("Senior Backend Developer", "Backend Engineer", True),
        ("Data Scientist", "Software Engineer", False),
        ("Product Designer", "Product Manager", False),
        ("Growth Marketing Lead", "growth marketer", False),  # one differing word is not enough
        ("Growth Marketer, EMEA", "growth marketer", True),   # custom role: all words present
        ("Customer Success Growth Marketer", "Growth Marketer", True),
    ],
)
def test_role_matching(title, wanted, expected):
    assert role_matches(title, wanted) is expected


def test_roles_match_any():
    assert roles_match("Platform Engineer", ["Data Scientist", "DevOps Engineer"])
    assert not roles_match("Accountant", ["Data Scientist", "DevOps Engineer"])
    assert not roles_match("Anything", [])


def test_resolve_explains_each_role():
    out = resolve(["SDE", "growth marketer"])
    assert out[0]["canonical"] == "software_engineer" and "software development engineer" in out[0]["also_matches"]
    assert out[1]["canonical"] is None and out[1]["label"] is None


def job(title, desc=""):
    return Job(source="gh", source_id=title, title=title, company="Acme", description=desc,
               apply_url="https://boards.greenhouse.io/acme/jobs/1", location="Remote", remote=True)


def test_discovery_filter_uses_the_taxonomy():
    prefs = Preferences(roles=["SDE"], locations=[], remote_ok=True)
    assert matches(job("Software Development Engineer II"), prefs)
    assert matches(job("Member of Technical Staff"), prefs)
    assert not matches(job("Account Executive"), prefs)


def test_ranking_prefers_titles_that_fit_a_wanted_role_whatever_they_are_called():
    profile = Profile(skills=[], preferences=Preferences(roles=["FDE"], experience_level=""))
    jobs = [job("Marketing Manager"), job("Forward Deployed Software Engineer"), job("Office Manager")]
    top = prefilter(jobs, profile, limit=1, per_company_cap=5)
    assert top[0].title == "Forward Deployed Software Engineer"
