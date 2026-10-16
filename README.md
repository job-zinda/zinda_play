# Zinda Play — React + Node.js starter

## Requirements
- Node.js LTS (includes npm): https://nodejs.org/en/download
- A MongoDB database for video metadata, categories, and view counts.
- A Bunny Stream library for storing and streaming uploaded video files.

## Run
Open this folder in VS Code. In Terminal 1:
```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```
In Terminal 2:
```powershell
cd client
npm install
npm run dev
```
Open the Vite URL printed by the client terminal (usually http://localhost:5173).

## Admin access
Sign in through the Admin button with the credentials configured as `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `server/.env`. The server loads this file relative to its source, even when started from another working directory. If you change the values, restart the API. Set new, strong values before deploying anywhere public; the `.env.example` file uses placeholders and should not contain real credentials. Admin API routes require a server-issued bearer token; sessions are held in memory and expire when the server restarts or you sign out.

The API requires MongoDB and will not start without a valid `MONGODB_URI`. Create a MongoDB Atlas cluster (or use another MongoDB deployment), set `MONGODB_URI` in `server/.env`, and optionally set `MONGODB_DATABASE` (defaults to `zinda_play`). The API seeds the default categories when it starts. Video metadata, categories, and view counts are persisted in MongoDB; video files remain in Bunny Stream.

## Bunny Stream uploads
Configure `BUNNY_STREAM_LIBRARY_ID` and `BUNNY_STREAM_API_KEY` in `server/.env`, then restart the API to upload videos directly to Bunny Stream from the Admin content form. The API key stays on the server and must never be put in React/browser code. Uploads up to 2 GB report browser transfer progress; the dashboard polls Bunny's encoding status and stores status updates in MongoDB. A video is only listed publicly after processing finishes and it is published. Admins can publish or unpublish items from the dashboard. Existing player/embed URLs can still be entered manually.

Use **Admin → Banner** to configure the homepage promotion. Its title, description, call-to-action, and enabled state are saved in MongoDB; uploaded JPEG, PNG, WebP, and GIF banner images (up to 8 MB) are stored in MongoDB GridFS and shown to visitors when enabled. In **Admin → Add video**, upload an optional JPEG, PNG, WebP, or GIF thumbnail (up to 8 MB); thumbnail files are stored in MongoDB GridFS alongside the video's metadata.

When deploying the API to Render, configure `MONGODB_URI`, `MONGODB_DATABASE`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `CLIENT_ORIGIN` in the service environment. Use the deployed frontend's exact origin for `CLIENT_ORIGIN`. For private media, add a server-side signed playback flow.
