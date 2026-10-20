"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { analyze, type AtsResult } from "@/lib/ats/analyze";
import { ATS_ACCEPT, extractResumeText, validateAtsFile } from "@/lib/ats/extract-text";
import { SAMPLE_JD, SAMPLE_RESUME } from "@/lib/ats/sample";
import { AtsResults } from "./results";

const MIN_RESUME = 100;
const MIN_JD = 60;

/**
 * ATS Check: the resume and the posting are analysed entirely in the browser (PDF and DOCX are
 * parsed here too), so nothing is uploaded and no model is called. Extracted text lands in the
 * editable box so the user can see exactly what a parser would read and fix it.
 */
export function AtsChecker() {
  const [file, setFile] = useState<File | null>(null);
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [errors, setErrors] = useState<{ resume?: string; jd?: string }>({});
  const [result, setResult] = useState<AtsResult | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);

  const pick = async (f: File | null) => {
    setFile(f);
    setErrors((e) => ({ ...e, resume: undefined }));
    if (!f) return;
    const problem = validateAtsFile(f);
    if (problem) {
      setFile(null);
      return setErrors((e) => ({ ...e, resume: problem }));
    }
    setExtracting(true);
    try {
      setResume(await extractResumeText(f));
    } catch (err) {
      setFile(null);
      setErrors((e) => ({ ...e, resume: err instanceof Error ? err.message : "Could not read that file." }));
    } finally {
      setExtracting(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (resume.trim().length < MIN_RESUME) next.resume = "Add your resume: upload a file or paste at least a few lines.";
    if (jd.trim().length < MIN_JD) next.jd = "Paste the job description, including the requirements.";
    setErrors(next);
    if (next.resume || next.jd) return;
    setResult(analyze(resume, jd));
  };

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="flex flex-col gap-5">
            <h2 className="text-h3 font-semibold tracking-tight">1. Your resume</h2>
            <Field label="Upload a file" error={errors.resume && !resume ? errors.resume : undefined} hint="PDF, DOCX or TXT, up to 5 MB.">
              <FileDropzone file={file} onFile={pick} disabled={extracting} accept={ATS_ACCEPT} />
            </Field>
            {extracting && (
              <p role="status" className="flex items-center gap-2 text-small text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Reading your file in this browser...</p>
            )}
            <Field
              label="Resume text"
              hint="Uploaded files appear here, so you can see what a parser reads. You can edit it."
              error={errors.resume && resume ? errors.resume : undefined}
            >
              <Textarea className="min-h-56 font-mono text-small" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Or paste your resume text here" />
            </Field>
          </Card>

          <Card className="flex flex-col gap-5">
            <h2 className="text-h3 font-semibold tracking-tight">2. The job description</h2>
            <Field label="Job description" error={errors.jd} hint="Paste the whole posting, including requirements and nice-to-haves.">
              <Textarea className="min-h-[22rem] text-small" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job posting here" />
            </Field>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" size="lg" disabled={extracting} magnetic>Check my resume</Button>
          <button type="button" onClick={() => { setResume(SAMPLE_RESUME); setJd(SAMPLE_JD); setFile(null); setErrors({}); }} className="text-small font-medium text-primary hover:underline">
            Try it with sample data
          </button>
          <p className="flex items-center gap-1.5 text-small text-muted">
            <ShieldCheck className="size-4 text-success-ink" aria-hidden /> Stays in your browser. Nothing is uploaded.
          </p>
        </div>
      </form>

      {result && <AtsResults result={result} headingRef={heading} />}
    </div>
  );
}
