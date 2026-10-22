"""Key management CLI: `python -m nextrole.security genkey | rotate | encrypt-existing`."""
import sys

from nextrole.config import get_settings
from nextrole.db.connection import connect
from nextrole.security import crypto
from nextrole.security.protect import encrypt_existing, rotate_all


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else ""
    if cmd == "genkey":
        print(f"ENCRYPTION_KEYS=k1:{crypto.generate_key()}")
        print("# To rotate: generate a new key, put it FIRST (ENCRYPTION_KEYS=k2:<new>,k1:<old>), "
              "run `rotate`, then remove the old key.")
        return 0
    if cmd in {"rotate", "encrypt-existing"}:
        settings = get_settings()
        keyring = crypto.Keyring.parse(settings.encryption_keys, settings.resume_encryption_key)
        if keyring is None:
            print("No keys configured (ENCRYPTION_KEYS).", file=sys.stderr)
            return 2
        crypto.configure(keyring)
        conn = connect(settings.db_path)
        run = rotate_all if cmd == "rotate" else encrypt_existing
        counts = run(conn, keyring, settings.upload_dir, settings.resume_encryption_key)
        print(f"{cmd}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
        return 0
    print(__doc__, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
