from pathlib import Path
import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright


CHROME_PATH = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PROFILE_DIR = Path.home() / "AppData" / "Local" / "notebooklm-mcp" / "Data" / "chrome_profile"


def visible_texts(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('button,[role="button"],a,input[type="button"]'))
            .map(el => ({
              text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim(),
              tag: el.tagName,
            }))
            .filter(x => x.text)
            .slice(0, 200)"""
    )


def dump_mode(args) -> int:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=str(CHROME_PATH),
            headless=args.headless,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(7000)
        data = {
            "url": page.url,
            "title": page.title(),
            "buttons": visible_texts(page),
            "body": page.locator("body").inner_text()[:5000],
        }
        print(json.dumps(data, ensure_ascii=True, indent=2))
        context.close()
    return 0


def upload_mode(args) -> int:
    files = [str(Path(f).resolve()) for f in args.files]
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            executable_path=str(CHROME_PATH),
            headless=args.headless,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(5000)

        upload_button = page.get_by_role("button", name="Upload files")
        if upload_button.count() == 0:
            upload_button = page.get_by_text("Upload files", exact=False)

        with page.expect_file_chooser(timeout=15000) as chooser_info:
            upload_button.first.click()
        chooser = chooser_info.value
        chooser.set_files(files)

        page.wait_for_timeout(30000)
        print("Uploaded files:", len(files))
        print("Current URL:", page.url)
        print("Visible buttons:", json.dumps(visible_texts(page), ensure_ascii=True))
        print("Body:", page.locator("body").inner_text()[:5000].encode("ascii", "backslashreplace").decode("ascii"))
        context.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    dump = sub.add_parser("dump")
    dump.add_argument("--url", required=True)
    dump.add_argument("--headless", action="store_true")

    upload = sub.add_parser("upload")
    upload.add_argument("--url", required=True)
    upload.add_argument("--headless", action="store_true")
    upload.add_argument("files", nargs="+")

    args = parser.parse_args()
    if args.cmd == "dump":
        return dump_mode(args)
    if args.cmd == "upload":
        return upload_mode(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
