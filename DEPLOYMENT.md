# Deployment Guide

This project is ready for a simple public deployment on Render.

## What is already prepared
- Procfile
- requirements.txt
- Python server at server.py

## Render deployment steps
1. Push the project to GitHub.
2. Open Render and create a new Web Service.
3. Connect the GitHub repository.
4. Choose the repository.
5. Set the build command to:
   ```bash
   pip install -r requirements.txt
   ```
6. Set the start command to:
   ```bash
   python server.py
   ```
7. Deploy.

## Expected result
After deployment, the site will be available at the Render URL and the vote API will work at:
```text
https://<your-render-app>.onrender.com/api/votes
```

## Notes
- The app stores votes in a JSON file in the server environment.
- For larger public use, a database-backed solution can be added later.
