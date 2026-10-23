"""Password policy, enforced on the server (client checks are only a convenience).

Rules: 8-256 characters, at least one uppercase letter, one lowercase letter and one special
character (anything that is not a letter, digit or whitespace). Returns the unmet rules so the
API can say exactly what to fix. The frontend mirrors this in `lib/validation.ts`.
"""

MIN_LENGTH = 8
MAX_LENGTH = 256


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < MIN_LENGTH:
        problems.append(f"at least {MIN_LENGTH} characters")
    if len(password) > MAX_LENGTH:
        problems.append(f"at most {MAX_LENGTH} characters")
    if not any(c.isupper() for c in password):
        problems.append("an uppercase letter")
    if not any(c.islower() for c in password):
        problems.append("a lowercase letter")
    if not any(not (c.isalnum() or c.isspace()) for c in password):
        problems.append("a special character")
    return problems
