# Task Tracker

Task tracker webapp for software development work. The backend is Python + Flask + SQLite, and the frontend is React + Vite.

## Run

1. Refresh the frontend bundle:
   `npm install`
   `npm run build`
2. Start the backend:
   `.venv/bin/python backend/app.py`
3. Open `http://127.0.0.1:8000`

## Features

- Projects for classifying tasks
- Tasks with description, status, attachments, and comments
- Comment attachments
- Image attachment thumbnails
- Searchable, filterable list view
- Per-project kanban board with drag-and-drop status changes
