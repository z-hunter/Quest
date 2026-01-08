# Scanline: AI-Powered Retro-Vibe Adventure game Engine [WIP]

**Scanline** is a 2D third-person adventure game engine inspired by 80s classics (like early Sierra and LukasArt games) with a modern twist. It combines traditional Point-n-Click mechanics for movement and inspection with a _text parser_ for interactions.

## Key Features

*   **Hybrid Controls**: Point-n-Click for navigation + Text Parser for actions. No more "scroll and click everything" pixel hunting.
*   **AI Game Master**: An AI (LLM) acts as the bridge between the player and the game engine. It parses natural language commands, generates descriptions, and drives dynamic conversations with NPCs.
*   **Retro Aesthetics**: Pixel art style, CRT shader effects, and a command-line interface.
*   **Integrated Editor**: Built-in tools for editing scenes, defining sprites and game logic (polygonal walkboxes, triggers).

## Installation and Run (Windows)

### Prerequisites

*   **Node.js**: You need to have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).

### Quick Start (Windows)

1.  Clone this repository.
2.  Open the project folder.
3.  Run `setup.cmd`. This will install dependencies and start the game in your default browser at `http://localhost:5173`.

## Hosting on a Web Server (Linux)

To run the game on a Linux web server (e.g., Nginx or Apache):

1.  Build the project for production:
    ```bash
    npm run build
    ```
2.  This will create a `dist` directory containing the static files.
3.  Upload the contents of the `dist` directory to your web server's public folder.

> **Note**: The integrated **Scene Editor** and **Sprite Editor** features rely on a local backend to save files directly to local disk. These features will **not** work when hosted as a static site. The game itself can be played if all necessary assets are pre-built.

## Project Structure

*   `src/` - Source code (React, TypeScript).
*   `public/` - Static assets (sprites, sounds, scenes).
*   `GDD.md` - Game Design Document (Russian).

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** license. You are free to share and adapt the material for non-commercial purposes, provided you give appropriate credit. See the `LICENSE` file for details.
 
