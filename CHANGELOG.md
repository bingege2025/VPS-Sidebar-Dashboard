# Changelog

All notable changes to VPS Dashboard are documented here.

## 1.6.3 - 2026-08-30

### Added
- Four more control panels are now selectable: Proxmox VE (API Token), Hetzner Cloud (API Token), DigitalOcean (API Token), and AWS Lightsail (IAM Access Key + Secret). Each supports status, resource view, and power actions (start / stop / reboot).
- All four are marked experimental — they are newly enabled, so please report anything that looks off.
- Setup guides for the four new panels are now linked from the Settings page (also published on the project site).
- Lower-friction feedback:
  - GitHub issue templates now auto-fill anonymous diagnostics (configured server count by provider type, extension version, language, analytics state) so reporters don't type environment details and follow-ups are rarely needed. No credentials, keys, hostnames, or IPs are included.
  - A "Report this error" button now appears on the error screen; one click opens a pre-filled bug report carrying the captured error message and diagnostics.
  - A new "Quick feedback" link in the popup footer opens an anonymous, no-login feedback page (no GitHub account required) that submits in seconds.
  - "Request a provider" and "Report a bug" in the popup footer now open that same anonymous feedback page with the right category preselected, instead of requiring a GitHub account; submissions go to anonymous analytics.

### Changed
- The panel type selector and the first-run "Get Started" screen now list every supported provider, keeping the two in sync.

### Fixed
- Choosing a provider that has no setup guide no longer leaves the previous provider's field labels on the Add Server form.
- Picking a provider without a setup guide from the "Get Started" screen now correctly preselects it in Settings.
- Store short description (manifest `description`) was 137 characters, over the Chrome Web Store 132-character limit; it now uses per-locale `__MSG_appDescription__` and the en/de/fr strings are trimmed so every language is within the limit.

## 1.6.2 - 2026-08-29

### Added
- First-run onboarding: opening the extension with no servers configured now shows a Get Started view instead of the empty state. Pick a provider (SolusVM, SolusVM 2, AWS EC2, VirtFusion, or Virtualizor) and Settings opens with that panel type already selected. "Skip for now" returns to the previous empty state.
- Opt-out switch for anonymous usage analytics in Settings (default on). Turning it off stops all analytics events from being sent. Available in all five languages (zh/en/de/fr/ru).

### Changed
- Privacy copy made accurate across PRIVACY.md, PRIVACY_ANALYTICS.md, and CHROMEWEBSTORE.md:
  - Clarified that Google Analytics receives the network IP used to transmit each event (no IP is placed in the event data itself), and recommended enabling IP anonymization in the GA4 property.
  - Analytics event names now use ASCII snake_case (for example `extension_opened`, `save_server`), matching GA4 Measurement Protocol requirements; the event reference in PRIVACY_ANALYTICS.md has been updated to match.
  - Marked the analytics opt-out as implemented (Settings switch), not just reserved.
  - Reworded "Local-only and privacy-first" to "Local-first" and noted anonymous analytics is the only third-party request and can be disabled.
  - Added a note that GA infers an approximate location from IP, so the Chrome Web Store data-disclosure should declare Location.

## 1.6.1 - 2026-08-16

### Added

- Anonymous feature-usage analytics for product improvement. Events include feature names and provider type only, never credentials or server identity.
- Experimental Virtualizor support for single-VPS accounts.

### Fixed

- Virtualizor power actions now include the required `do=1` parameter.
- Virtualizor is shown with provider metadata in the UI.
- README, privacy policy, and Chrome Web Store notes now match the analytics behavior.

## 1.6.0 - 2026-08-04

### Added

- Expiry reminder for every panel type (SolusVM v1/v2, VirtFusion, Virtualizor, Proxmox, Hetzner, DigitalOcean, AWS EC2, AWS Lightsail).
- Per-server expiry date field in settings; the extension computes days remaining and warns you before a server lapses.
- Background expiry reminders via `chrome.alarms` (check every 6 hours) + `chrome.notifications`.
- Multi-threshold reminders: notify at 30 / 7 / 3 days before expiry; expired servers remind once per day.
- API-pulled expiry: when a provider API returns a billing/expiry date (SolusVM v2, VirtFusion, and others), it is automatically pulled and stored; manual entry always wins and can override API values. A note warns that API dates may be inaccurate and should be verified.
- Per-server reminder opt-out toggle in settings.
- Global master switch for expiry reminders.
- Calendar export: download a `.ics` file (RFC 5545) for a single server or all servers, with built-in `VALARM` reminders at each threshold — importable into Google Calendar, Apple Calendar, Outlook, etc.
- In-popup reminder: a colored banner on the server detail view and an Expires row when a date is set; upcoming expirations also surface as chips in the batch list.
- Expiry date and reminder threshold are included in config export/import.

### Changed

- Expiry preference is now multi-threshold (`expiryThresholds`, default `[3, 7, 30]`) instead of a single `expiryWarnDays` value.

### Notes

- API-expiry extraction is best-effort and provider-dependent; not all panels expose a billing date. When in doubt, set the date manually.

## 1.5.1 - 2026-07-31

### Added

- Static landing page for Chrome Web Store and search traffic.
- Provider-specific setup guides for SolusVM v1, AWS EC2, SolusVM v2, and VirtFusion.
- Setup guide links in the extension settings page based on the selected panel type.

## 1.5.0 - 2026-07-30

### Added

- Multi-provider dashboard positioning.
- AWS EC2 support: instance status and power control, EBS disk size (via DescribeVolumes), and monthly network traffic (via CloudWatch NetworkIn/Out).
- Experimental VirtFusion support.
- Batch refresh, reboot, and shutdown actions.
- Server selection for batch operations.
- Server config copy action.
- New extension icon.
- Chrome Web Store marketing screenshots.

### Changed

- Renamed product to "VPS Dashboard — Multi-Provider VPS Manager" (from a SolusVM-focused sidepanel).
- Panel type selector now supports SolusVM v1, SolusVM v2 (experimental), VirtFusion (experimental), and AWS EC2.
- Improved config page spacing and layout.
- Improved popup UI for multi-server and multi-provider usage.
- Power buttons now adapt to server state where supported.
- Actions refresh status after completion.

### Fixed

- EC2 reboot/shutdown reliability — reuse the existing Instance ID to avoid concurrent-fetch timeouts.
- SolusVM v1 no longer misreads an API-layer success response as a shutdown.
- Corrected memory/disk/bandwidth unit scaling across providers (EC2, Hetzner, Lightsail, Virtualizor).
- More tolerant AWS region/endpoint parsing (handles pasted URLs/domains).

### Notes

- AWS EC2 requires IAM permissions `ec2:DescribeVolumes` and `cloudwatch:GetMetricStatistics` to show disk and traffic.
- SolusVM v2 and VirtFusion support are experimental and may have provider-specific edge cases.
- SolusVM v1 remains supported for existing users.

## 1.4.0 - 2026-07-18

### Added

- Experimental SolusVM 2 API support.
- Config import and export.
- Dark mode.
- Inline reboot and shutdown confirmation.
- Pre-filled GitHub issue feedback link.
- English, Simplified Chinese, German, French, and Russian UI support.

### Fixed

- Deleted server configs no longer remain visible until manual refresh.
- Importing config no longer resets the selected UI language.

## 1.3.0 - 2026-07-12

### Added

- Multi-server profile management.
- Server search and tag filtering.
- Default server support.
- Privacy mode for screenshots and screen sharing.

## 1.2.0 - 2026-07-12

### Added

- Improved popup status display.
- Cache-first loading for faster status checks.

## 1.1.0 - 2026-06-24

### Added

- Initial RackNerd/SolusVM-focused improvements.

## 1.0.0 - 2026-06-22

### Added

- Initial Chrome extension release.
- SolusVM v1 status display.
- Basic reboot and shutdown actions.
