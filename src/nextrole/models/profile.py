"""Structured candidate profile (output of the Intake agent, editable by the user)."""
from pydantic import BaseModel, Field


class Experience(BaseModel):
    company: str
    title: str
    start: str = ""
    end: str = ""
    bullets: list[str] = Field(default_factory=list)


class Project(BaseModel):
    name: str
    description: str = ""
    tech: list[str] = Field(default_factory=list)


class Education(BaseModel):
    institution: str
    degree: str = ""
    year: str = ""


class Preferences(BaseModel):
    roles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    remote_ok: bool = True
    experience_level: str = ""
    extras: str = ""


class Profile(BaseModel):
    name: str = ""
    summary: str = ""
    skills: list[str] = Field(default_factory=list)
    experience: list[Experience] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    preferences: Preferences = Field(default_factory=Preferences)
