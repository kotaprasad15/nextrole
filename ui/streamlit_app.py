"""Streamlit shell: login/signup -> onboarding (resume upload) -> review/edit profile.

Talks to the FastAPI backend over HTTP only (no direct DB/agent access), so the UI stays a
thin client. Run: `uv run streamlit run ui/streamlit_app.py` (API on NEXTROLE_API, default
http://localhost:8000).
"""
import os

import httpx
import streamlit as st

API = os.environ.get("NEXTROLE_API", "http://localhost:8000")

st.set_page_config(page_title="NextRole", page_icon="🎯")
st.title("NextRole")

if "client" not in st.session_state:
    st.session_state.client = httpx.Client(base_url=API, timeout=120)
client: httpx.Client = st.session_state.client


def call(method: str, path: str, **kw) -> httpx.Response:
    try:
        return client.request(method, path, **kw)
    except httpx.TransportError:
        st.error(f"Cannot reach the API at {API}. Is the backend running?")
        st.stop()


def auth_view() -> None:
    mode = st.radio("", ["Log in", "Sign up"], horizontal=True)
    email = st.text_input("Email")
    password = st.text_input("Password (min 8 chars)", type="password")
    if st.button(mode):
        path = "/auth/login" if mode == "Log in" else "/auth/signup"
        r = call("POST", path, json={"email": email, "password": password})
        if r.is_success:
            st.session_state.email = email
            st.rerun()
        st.error(r.json().get("detail", "failed") if r.headers.get("content-type", "").startswith("application/json") else "failed")


def onboarding_view() -> None:
    st.subheader("Tell us what you're looking for")
    with st.form("onboarding"):
        roles = st.text_input("Desired roles (comma separated)", "Backend Engineer")
        locations = st.text_input("Locations (comma separated)", "")
        remote_ok = st.checkbox("Open to remote", True)
        level = st.selectbox("Experience level", ["Intern/New grad", "Junior", "Mid", "Senior"])
        extras = st.text_area("Other preferences (optional)")
        resume = st.file_uploader("Resume (PDF or DOCX)", type=["pdf", "docx"])
        if st.form_submit_button("Parse my resume") and resume:
            with st.spinner("Reading your resume..."):
                r = call(
                    "POST", "/onboarding",
                    data={"roles": roles, "locations": locations, "remote_ok": remote_ok,
                          "experience_level": level, "extras": extras},
                    files={"resume": (resume.name, resume.getvalue())},
                )
            if r.is_success:
                st.rerun()
            st.error(r.json().get("detail", "upload failed"))


def profile_view(profile: dict) -> None:
    st.subheader("Review your profile")
    st.caption("Parsed from your resume. Fix anything wrong before we use it.")
    profile["name"] = st.text_input("Name", profile["name"])
    profile["summary"] = st.text_area("Summary", profile["summary"])
    skills = st.text_input("Skills (comma separated)", ", ".join(profile["skills"]))
    profile["skills"] = [s.strip() for s in skills.split(",") if s.strip()]
    st.write("**Experience**", profile["experience"] or "none found")
    st.write("**Projects**", profile["projects"] or "none found")
    st.write("**Education**", profile["education"] or "none found")
    c1, c2, c3 = st.columns(3)
    if c1.button("Save changes"):
        r = call("PUT", "/profile", json=profile)
        st.success("Saved") if r.is_success else st.error(r.text)
    if c2.button("Log out"):
        call("POST", "/auth/logout")
        st.session_state.clear()
        st.rerun()
    if c3.button("Delete my account and data"):
        call("DELETE", "/me")
        st.session_state.clear()
        st.rerun()


me = call("GET", "/profile")
if me.status_code == 401:
    auth_view()
elif me.status_code == 404:
    onboarding_view()
else:
    profile_view(me.json())
