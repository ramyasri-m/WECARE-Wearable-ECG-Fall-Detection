# WECARE — Detailed Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Google Account | Any | Required for Colab + Drive |
| Python | 3.10+ | Pre-installed in Colab |
| GPU | Optional | CUDA speeds up training significantly |
| Groq API Key | Free | [console.groq.com](https://console.groq.com) |

---

## Google Drive Folder Structure

Before running any notebook, set up this folder structure in your Google Drive:

```
MyDrive/
├── AI4BM/
│   ├── IMU_MobiAct/
│   │   └── Output/          ← place MobiFall CSV files here
│   └── ECG_MITBIH/          ← ECG data auto-downloads via wfdb
└── IMU_MobiAct/
    └── models/              ← auto-created when you save models
```

---

## Dataset Download Instructions

### Dataset 1: MobiFall (IMU Fall Detection)

1. Go to [Kaggle MobiFall Dataset](https://www.kaggle.com/datasets/mrwellsdavid/mobifall)
2. Click **Download** (requires free Kaggle account)
3. Extract the ZIP file
4. Upload all CSV files to `MyDrive/AI4BM/IMU_MobiAct/Output/`

Expected files: CSV files named with activity codes like `FOL_sub1_trial1.csv`, `ADL_sub2_trial1.csv` etc.

Fall activity codes in dataset:
- `FOL` — Forward Fall
- `FKL` — Fall and Kneel
- `BSC` — Back Slip and Fall
- `SDL` — Sideward Fall

### Dataset 2: MIT-BIH Arrhythmia (ECG)

**Option A — Auto-download (recommended):**
The `WECARE_ECG.ipynb` notebook downloads MIT-BIH directly from PhysioNet using the `wfdb` library. No manual download needed.

**Option B — Manual download:**
1. Go to [PhysioNet MIT-BIH](https://physionet.org/content/mitdb/1.0.0/)
2. Download all files
3. Place at `MyDrive/AI4BM/ECG_MITBIH/`

---

## Running the Notebooks

### Order of Execution

```
1. WECARE_IMU.ipynb      → trains IMU model, saves weights
2. WECARE_ECG.ipynb      → trains ECG model, saves weights
3. WECARE_Orchestration.ipynb → loads both models, runs pipeline
```

**Important:** Notebooks 1 and 2 must complete successfully before running Notebook 3.

### WECARE_IMU.ipynb

```
Expected runtime: ~10-15 minutes (GPU) / ~45 minutes (CPU)

Key outputs:
- /content/drive/MyDrive/IMU_MobiAct/models/imu_model.pth
- /content/drive/MyDrive/IMU_MobiAct/models/feature_scaler.gz
- /content/drive/MyDrive/IMU_MobiAct/models/imu_test.npy
- /content/drive/MyDrive/IMU_MobiAct/models/imu_labels.npy

Expected metrics:
- F1-score: ~0.81
- Recall:   ~0.96
- Accuracy: ~0.92
```

### WECARE_ECG.ipynb

```
Expected runtime: ~15-20 minutes (GPU) / ~60 minutes (CPU)

Key outputs:
- /content/drive/MyDrive/AI4BM/ECG_MITBIH/models/ecg_model.pth
- /content/drive/MyDrive/AI4BM/ECG_MITBIH/models/ecg_scaler.gz
- /content/drive/MyDrive/AI4BM/ECG_MITBIH/models/ecg_test.npy
- /content/drive/MyDrive/AI4BM/ECG_MITBIH/models/ecg_labels.npy

Expected metrics:
- F1-score: ~0.99
- Accuracy: ~0.99
```

### WECARE_Orchestration.ipynb

```
Expected runtime: ~5 minutes

Prerequisites:
✅ imu_model.pth saved
✅ feature_scaler.gz saved
✅ ecg_model.pth saved
✅ ecg_scaler.gz saved
✅ imu_test.npy saved
✅ ecg_test.npy saved
✅ Groq API key set in Cell 6
```

---

## API Key Setup

### Groq (Required for LLM instructions)

1. Sign up at [console.groq.com](https://console.groq.com)
2. Navigate to **API Keys → Create API Key**
3. Copy the key (starts with `gsk_...`)
4. In `WECARE_Orchestration.ipynb` Cell 6:

```python
# Replace this line:
groq_client = Groq(api_key="your_groq_key_here")

# With your actual key:
groq_client = Groq(api_key="gsk_your_actual_key_here")
```

**Security note:** Never commit your API key to GitHub. Use environment variables in production.

---

## Troubleshooting

### "ModuleNotFoundError: No module named X"
```python
# Run at the top of any cell:
!pip install package_name --break-system-packages
```

### "NameError: name 'test_loader' is not defined"
Run cells in order from top to bottom. Use **Runtime → Run all**.

### "RuntimeError: size mismatch for ECG_CNN"
The ECG model architecture in the orchestration notebook must exactly match what was trained. Verify kernel sizes:
- Conv1 kernel: 15
- Conv2 kernel: 9
- Linear: 4096 → 256

### "AuthenticationError: invalid x-api-key"
Your Groq API key is wrong or expired. Generate a new one at console.groq.com.

### Drive not mounted
```python
from google.colab import drive
drive.mount('/content/drive', force_remount=True)
```

### Slow training
Enable GPU: **Runtime → Change runtime type → T4 GPU**

---

## Path Configuration

If your Google Drive folder structure differs, update these variables:

In `WECARE_IMU.ipynb` Cell 1:
```python
DATA_FOLDER = "/content/drive/MyDrive/YOUR_PATH/IMU_MobiAct/Output"
```

In `WECARE_ECG.ipynb` Cell 1:
```python
ECG_ROOT = "/content/drive/MyDrive/YOUR_PATH/ECG_MITBIH"
```

In `WECARE_Orchestration.ipynb` Cell 1:
```python
IMU_MODEL_PATH  = "/content/drive/MyDrive/YOUR_PATH/imu_model.pth"
IMU_SCALER_PATH = "/content/drive/MyDrive/YOUR_PATH/feature_scaler.gz"
ECG_MODEL_PATH  = "/content/drive/MyDrive/YOUR_PATH/ecg_model.pth"
ECG_SCALER_PATH = "/content/drive/MyDrive/YOUR_PATH/ecg_scaler.gz"
```
