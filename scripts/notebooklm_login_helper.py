from pathlib import Path
import time

from playwright.sync_api import sync_playwright


NOTEBOOKLM_URL = "https://notebooklm.google.com/"
NOTEBOOKLM_HOST = "notebooklm.google.com"
HOME = Path.home() / ".notebooklm"
PROFILE_DIR = HOME / "browser_profile"
STORAGE_PATH = HOME / "storage_state.json"


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)

    print("Opening browser for NotebookLM login...")
    print(f"Profile: {PROFILE_DIR}")
    print("Complete Google login and wait for the NotebookLM homepage.")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--password-store=basic",
            ],
            ignore_default_args=["--enable-automation"],
        )

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(NOTEBOOKLM_URL, wait_until="load")

        deadline = time.time() + 600
        while time.time() < deadline:
            try:
                current_url = page.url
            except Exception:
                current_url = ""

            try:
                cookies = context.cookies(["https://accounts.google.com", NOTEBOOKLM_URL])
            except Exception:
                cookies = []
            cookie_names = {cookie.get("name", "") for cookie in cookies}

            if NOTEBOOKLM_HOST in current_url and "SID" in cookie_names:
                try:
                    page.wait_for_load_state("load", timeout=5000)
                except Exception:
                    pass
                context.storage_state(path=str(STORAGE_PATH))
                context.close()
                print(f"Authentication saved to: {STORAGE_PATH}")
                return 0

            time.sleep(2)

        context.close()
        print("Timed out waiting for NotebookLM login to complete.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
