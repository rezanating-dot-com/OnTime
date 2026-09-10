# Privacy Policy

**OnTime — Islamic Prayer Times**

*Last updated: September 10, 2026*

## Overview

OnTime calculates your prayer times on your device. There are no accounts, no
analytics, no advertising, and no third-party SDKs that collect data. Nothing
you do in the app is reported to us, because there is nowhere for it to be
reported to — we do not run a server.

This policy describes every request the app makes to anyone else's server, and
what each one reveals.

## Data that stays on your device

Stored on your device only, and never transmitted anywhere:

- Your prayer calculation method, Asr madhab, and display preferences
- Your prayer tracking history
- Jumuah, travel mode, and notification settings
- Your home base location, used by travel mode
- Theme and design choices
- Downloaded athan audio

All prayer times, Qibla bearings, and sun positions are computed on the device
from your coordinates. That arithmetic never leaves the phone.

## Location

OnTime asks for your device's location to calculate prayer times and the Qibla
direction. Approximate ("coarse") location is enough; the app works fine if you
choose it, and it works fine if you decline location entirely and set your city
by hand.

Your coordinates leave the device in three situations, all described below.

## Every network request the app makes

**1. Naming your city — OpenStreetMap Nominatim**
`nominatim.openstreetmap.org`

Your coordinates are sent so the app can show a place name instead of two
numbers. This happens when your location is first found and whenever you
refresh it. Nominatim's usage policy:
https://operations.osmfoundation.org/policies/nominatim/

**2. The map preview — OpenStreetMap**
`openstreetmap.org`

Tapping your city name opens a small map centred on you. That embedded map is
loaded from OpenStreetMap and receives your coordinates, along with whatever a
web request normally carries, including your IP address. It loads only when you
open that preview.

**3. The globe's surface imagery — Esri**
`server.arcgisonline.com`

**Only if you zoom in.** The globe home screen paints the Earth with a
satellite photo that ships inside the app, and at the normal zoom nothing is
requested at all. Zoom in past roughly a third of the way to the surface and
the app starts streaming sharper imagery from Esri's World Imagery service.

It requests map squares rather than coordinates — but the squares are the ones
you are looking at, and the globe opens pointed at you, so **once it starts,
these requests reveal roughly where you are**, and the further you zoom the
more precisely. Esri's privacy policy:
https://www.esri.com/en-us/privacy/overview

Two ways this never runs: leave the globe at its normal zoom, or use the list
home view instead.

**4. Athan recordings — Assabile**
`www.assabile.com`

Only when you go looking for them. Opening the athan sound picker in Settings
fetches the list of available recordings, and choosing one downloads that audio
file to your device. Nothing about you is sent beyond what any web request
carries. Once downloaded, the audio plays from your device with no further
requests.

## What we do not do

- No account, ever
- No analytics, crash reporting, or telemetry
- No advertising, and no advertising identifiers
- No third-party SDKs that collect data
- No selling or sharing of anything, because we hold nothing

## Permissions, and why

- **Location** — prayer times and Qibla direction
- **Notifications** — prayer reminders and athan alerts
- **Exact alarms** — so a prayer notification arrives at the prayer time rather
  than whenever the system next feels like waking the app
- **Ignore battery optimisations** *(optional, you are asked)* — so reminders
  survive aggressive power saving on some devices

## Children's privacy

OnTime collects no personal information from anyone, children included, and
needs none to work.

## Changes to this policy

Changes appear on this page with a new date at the top. The version that
matters is the one shipping with the app you have installed.

## Contact

Open an issue at https://github.com/rezanating-dot-com/OnTime/issues
