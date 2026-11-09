# Store listing

One text for the Chrome Web Store and Firefox AMO. The install is the player's consent, so the listing states what the extension does after install.

## Name

subtails Profile Manager

## Summary (under 132 characters)

Sends your Steam preference record and the games you own on Epic to subtails, under your own subtails session.

## Description

subtails Profile Manager keeps your subtails account up to date with two stores.

What it reads, under your own browser session:
- Steam: your preference record (dismissals, exclusions, wishlist) from store.steampowered.com.
- Epic: your order history from accounts.epicgames.com. Only the games you currently own leave the page: offer id, namespace, title and acquisition time. Never an order id, a price or a payment field.

When it runs: automatically, at most once a day per store, when you visit subtails while signed in. It acts only on subtails.com and only where a signed in subtails page is present. A signed out visit reads nothing.

What reaches subtails: the extension uploads nothing itself. The subtails page posts the data under your subtails session.

How to stop and delete: open your Steam or Epic settings page on subtails. Deleting imported data there also stops automatic runs until you turn them back on.

The extension never reads or stores an Epic or Steam cookie or token, and never changes anything at Epic. Steam changes happen only when you click a reviewed Write-Back batch.

Source code: https://github.com/subtails/subtails-profile-manager (GPL-3.0-only).

## Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | Runs the reader on the subtails settings page you clicked from. |
| `scripting` | Hands the data to the subtails page in the same browser realm, and runs the Epic reader inside an open Epic tab when the background worker cannot reach Epic. |
| `storage` | Keeps one last run time per store, so each store runs at most once a day. |
| `https://store.steampowered.com/*` | Reads your Steam preference record and carries out a Write-Back batch you reviewed. |
| `https://accounts.epicgames.com/*` | Reads your Epic order history, one read-only page at a time. |
| `https://subtails.com/*` | Content script and hand-off on subtails pages only, to run the daily refresh while you are signed in. |

## Privacy page

https://subtails.com/privacy, section "Browser extension".

## Review notes

Reproduce the bundle with `BUILD.md` from the source archive. Packages are unsigned: each store signs after upload.
