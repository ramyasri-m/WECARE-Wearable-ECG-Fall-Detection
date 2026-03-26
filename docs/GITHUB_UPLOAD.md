# How to Upload WECARE to GitHub

## Step 1: Create the Repository

1. Go to [github.com](https://github.com) and sign in
2. Click the **+** icon → **New repository**
3. Settings:
   - Repository name: `wecare`
   - Description: `Wearable Emergency Cardiac and Fall Response System — on-device 1D CNN detection with BLE proximity and LLM-guided multi-actor coordination`
   - Visibility: **Public** (required for job applications)
   - **Do NOT** initialize with README (you already have one)
4. Click **Create repository**

---

## Step 2: Download Your Files from Colab

In each Colab notebook, go to:
**File → Download → Download .ipynb**

Download these three files:
- `WECARE_IMU.ipynb`
- `WECARE_ECG.ipynb`
- `WECARE_Orchestration.ipynb`

---

## Step 3: Set Up Local Repository

Open terminal on your computer:

```bash
# Create a folder for the project
mkdir wecare
cd wecare

# Initialize git
git init

# Copy all files from the GitHub-ready package here:
# - README.md
# - requirements.txt
# - .gitignore
# - LICENSE
# - WECARE_IMU.ipynb
# - WECARE_ECG.ipynb
# - WECARE_Orchestration.ipynb
# - docs/SETUP.md
# - docs/ARCHITECTURE.md
# - docs/RESULTS.md
```

---

## Step 4: Clean Your Notebooks Before Uploading

**Important:** Remove your Groq API key from WECARE_Orchestration.ipynb before uploading.

Open the notebook and find Cell 6:
```python
# Change this:
groq_client = Groq(api_key="gsk_your_actual_key")

# To this:
groq_client = Groq(api_key="YOUR_GROQ_API_KEY_HERE")
```

---

## Step 5: Add and Push Files

```bash
# Add the remote repository (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/wecare.git

# Add all files
git add .

# First commit
git commit -m "Initial commit: WECARE Phase I + II

- Phase I: 1D CNN fall detection (F1=0.81) and arrhythmia detection (F1=0.99)
- Phase II: 5-state FSM orchestration engine with dual-signal fast-path
- BLE proximity module (Apple COVID EN framework)
- LLM instruction generator (llama-3.3-70b, AHA-aligned)
- Multi-actor coordination: patient, bystander, remote responder
- Bulk evaluation: 1228 real test windows, 57.4% ALERT_ACTIVE, 0 false escalations"

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 6: Add Topics to Your Repository

On GitHub, go to your repository and click the gear icon next to **About**.

Add these topics:
```
pytorch deep-learning wearable-health iot emergency-response
fall-detection arrhythmia-detection edge-ai ble llm
python google-colab medical-ai
```

---

## Step 7: Pin the Repository

Go to your GitHub profile and click **Customize your pins** to pin the WECARE repository. This makes it visible when recruiters visit your profile.

---

## What NOT to Upload

Never upload (already in .gitignore):
- `*.pth` — model weights (too large, ~50MB each)
- `*.gz` — scalers
- `*.npy` — test sets
- `*.csv` — dataset files
- API keys

---

## Repository URL Format

After upload, your repository will be at:
```
https://github.com/YOUR_USERNAME/wecare
```

This is what you put on your resume and job applications.
