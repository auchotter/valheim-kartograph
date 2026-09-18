# Valheim Kartograph

**A shared map for Valheim players who prefer to explore without the in-game map.**

Valheim Kartograph gives you and your group one shared world map that you can open in a web browser.

Draw the world as you discover it, mark important places, add roads and notes, and see changes from other players in real time.

Kartograph does not read your Valheim world or reveal unexplored terrain. It starts as a blank canvas and you build the map yourselves as you explore.

## What can you do?

- Draw all Valheim biomes as you explore
- Add roads, sailing routes and other paths
- Place markers for portals, bosses, caves, traders, resources and more
- Add captions and free-form text
- Keep several different world maps
- Undo and redo map changes
- Import and export individual maps
- Collaborate with other players in real time
- Navigate using normal Valheim X / Z coordinates
- Keep everything on your own computer or server

No external account or cloud service is required.

## Getting started

### Not sure how to install it?

You do not need to be a developer or know how GitHub works.

If terms such as Node.js, Docker or self-hosting are unfamiliar, the easiest option is to ask your AI assistant of choice to guide you.

Give it the link to this repository and say something like:

> I want to install Valheim Kartograph. I am a beginner. Please choose the easiest installation method for my computer or server and guide me one step at a time.

Tell it whether you are using Windows, macOS, Linux, Docker, a NAS or Unraid.

It can help you choose the simplest method for your setup and walk you through the installation.

## Installation options

### Run directly on your computer

Valheim Kartograph can run directly on Windows, macOS or Linux.

If you already have Node.js 24 or newer installed, download or clone this repository and run:

    npm ci
    npm run build
    npm start

Then open:

    http://localhost:3000

This is a good option if you simply want to try Kartograph on your own computer.

### Run with Docker

A ready-made Docker image is available at:

    ghcr.io/auchotter/valheim-kartograph:latest

Docker is a convenient option if you want Kartograph to keep running in the background on a computer, home server or NAS.

Your map data should be stored persistently by mounting a host directory to:

    /data

For detailed Docker instructions, see the technical documentation below.

### Install on Unraid

Valheim Kartograph is available through **Unraid Community Applications**.

1. Open **Apps**
2. Search for **Valheim Kartograph**
3. Click **Install**
4. Open the **WebUI**

Your maps are stored persistently in your Unraid appdata folder.

## Using Kartograph

Create a map, then use the tools in the top-right corner to draw terrain, paths, markers and text.

The Map Library lets you create, rename, duplicate, delete, import and export maps.

Multiple people can open the same Kartograph server at the same time. Changes appear for everyone in real time.

For the best experience, use a desktop or laptop browser.

## Made for no-map playthroughs

Valheim Kartograph does **not** generate your world map, read your Valheim save or reveal unexplored terrain.

It is intentionally a blank canvas.

You build the map yourselves as you explore, making navigation, landmarks and shared knowledge part of the adventure.

## Your map stays with you

Kartograph is self-hosted.

Your maps are stored on the computer or server where you run it rather than in a Valheim Kartograph cloud service.

You can also export individual maps as `.valheim-kartograph.json` files for portability or sharing.

## Important security note

Valheim Kartograph currently has **no login system**.

Anyone who can access your Kartograph server can edit or delete maps.

Keep it on a trusted home network, VPN, or behind an authenticated reverse proxy. Do not expose it directly to the public Internet.

## Technical documentation

Looking for Docker configuration, backups, SQLite details, ports, development instructions, architecture or other technical information?

**[Read the technical documentation](docs/TECHNICAL.md)**

## Docker image

Official container images are published at:

    ghcr.io/auchotter/valheim-kartograph

Versioned releases are available through the GitHub Releases page.

## Licence

Valheim Kartograph is licensed under the Apache License 2.0 with the Commons Clause.

See [LICENSE](LICENSE) for the full terms.
