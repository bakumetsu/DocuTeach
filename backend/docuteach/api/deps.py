"""Shared FastAPI dependencies for the DocuTeach API."""

from fastapi import Request

from docuteach.config import Settings
from docuteach.store.library import Library


def get_library(request: Request) -> Library:
    """Return the Library instance stored on app.state."""
    return request.app.state.library  # type: ignore[no-any-return]


def get_settings(request: Request) -> Settings:
    """Return the Settings instance stored on app.state."""
    return request.app.state.settings  # type: ignore[no-any-return]
