# WECARE — System Architecture

## Design Philosophy

WECARE is built around four principles:

1. **Edge-first** — all detection runs on-device, no cloud dependency
2. **Privacy-preserving** — no GPS, no persistent identifiers, no data transmission
3. **Fail-safe** — confirmation window prevents false positive alerts
4. **Role-differentiated** — patient, bystander, and responder receive different information

---

## Component 1: Detection Module (Phase I)

### IMU Fall Detection

**Input:** Raw 100×9 sensor window (1 second at ~100Hz)
- 3 accelerometer channels (acc_x, acc_y, acc_z)
- 3 gyroscope channels (gyro_x, gyro_y, gyro_z)
- 3 orientation channels (azimuth, pitch, roll)

**Preprocessing:**
- Missing values: forward/backward fill (ffill/bfill)
- Normalization: StandardScaler fit on training data
- Windowing: 100 samples, 50-sample step size

**Architecture:**
```
Conv1D(9→64, k=7, pad=3) → ReLU → MaxPool(2)     # Block 1
Conv1D(64→128, k=7, pad=3) → ReLU → MaxPool(2)   # Block 2
Conv1D(128→256, k=5, pad=2) → ReLU → MaxPool(2)  # Block 3
Flatten → Linear(3072→256) → ReLU → Dropout(0.3) → Linear(256→2)
```

**Training:**
- Optimizer: Adam (lr=1e-3, weight_decay=5e-5)
- Loss: CrossEntropyLoss with class weights
- Sampler: WeightedRandomSampler for class imbalance
- Epochs: 20
- Split: 80/15/5 train/val/test (file-level, no leakage)

**Threshold:** 0.65 (tuned for high recall, safety-critical)

---

### ECG Arrhythmia Detection

**Input:** Raw 256-sample ECG segment (one heartbeat, ~0.71s at 360Hz)
- Single channel (MLII lead)
- Segmented around R-peaks using wfdb

**Preprocessing:**
- Bandpass filter: Butterworth 0.5–40Hz (removes baseline wander)
- R-peak segmentation: ±128 samples around each R-peak
- Normalization: StandardScaler fit on (N×256, 1) shape

**Architecture:**
```
Conv1D(1→32, k=15, pad=7) → ReLU → MaxPool(2)   # Block 1: 256→128
Conv1D(32→64, k=9, pad=4) → ReLU → MaxPool(2)   # Block 2: 128→64
Conv1D(64→128, k=5, pad=2) → ReLU → MaxPool(2)  # Block 3: 64→32
Flatten → Linear(4096→256) → ReLU → Dropout(0.3) → Linear(256→2)
```

**Training:**
- Same optimizer and loss as IMU
- Split: 80/10/10 train/val/test (stratified)
- WeightedRandomSampler for severe class imbalance (Normal >> Arrhythmia)

**Threshold:** 0.50 (default, high precision maintained)

---

## Component 2: Severity Classifier

Fuses both detection outputs into a single categorical label.

```python
def classify_severity(fall_result, ecg_result):
    fall  = fall_result["fall_detected"]
    arrhy = ecg_result["arrhythmia_detected"]
    fp    = fall_result["fall_prob"]

    if fall and arrhy:     return "HIGH"    # dual-signal (most critical)
    elif arrhy:            return "HIGH"    # cardiac alone always HIGH
    elif fall and fp>=0.85: return "MEDIUM"
    elif fall:             return "LOW"
    else:                  return "NONE"
```

**Clinical rationale:**
- Simultaneous fall + arrhythmia indicates **syncope** (fainting due to cardiac event) — the most dangerous scenario
- Arrhythmia alone is always HIGH because cardiac arrest can occur without physical fall
- Fall alone severity scales with detection confidence

---

## Component 3: Orchestration Engine (FSM)

### State Definitions

| State | Description | Patient Alert | Bystander | Responder |
|-------|-------------|---------------|-----------|-----------|
| IDLE | Monitoring | None | None | None |
| ALERT_PENDING | Event detected, confirming | Vibrate | None | None |
| ALERT_ACTIVE | Confirmed emergency | Audio | LLM Instructions | None |
| ESCALATING | No bystander response | Audio | LLM Instructions | Event summary |
| RESOLVED | Safe confirmed | Dismiss | Dismiss | Acknowledge |

### Timing Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Confirmation window | 5 seconds | Filters transient false positives |
| Bystander timeout | 60 seconds | Reasonable response window |
| Dual-signal skip | Immediate | No delay for highest-risk events |

### Dual-Signal Fast-Path

The most important design decision in Phase II.

```
Standard path:  IDLE → PENDING (5s) → ACTIVE
Fast path:      IDLE ────────────────→ ACTIVE  (dual HIGH only)
```

When both fall_detected AND arrhythmia_detected simultaneously:
- Skip ALERT_PENDING entirely
- Transition directly to ALERT_ACTIVE
- Immediately trigger audio alert, BLE broadcast, LLM generation

This is justified because the 5-second window exists to filter false positives. When both independent sensors confirm simultaneously, the probability of a false positive is the product of both individual false positive rates (~0.09 × 0.01 = 0.0009), making confirmation unnecessary.

---

## Component 4: BLE Proximity Module

### Design Inspiration
Apple's COVID-19 Exposure Notification (EN) framework, published April 2020. Uses identical RSSI threshold (-70 dBm) and distance estimation formula.

### How it Works

1. Wearable device broadcasts BLE advertisement packet on entering ALERT_ACTIVE
2. Nearby phones scan for the beacon
3. RSSI (Received Signal Strength Indicator) measured
4. Distance estimated using log-distance path loss model:

```
d = 0.89976 × (RSSI / TxPower)^7.7095 + 0.111
```

Where TxPower = -59 dBm (calibrated at 1 meter)

5. If RSSI ≥ -70 dBm → bystander classified as actionably close

### RSSI Reference Values

| RSSI | Approx Distance | Classification |
|------|----------------|----------------|
| -40 dBm | ~0.1m | Very close |
| -55 dBm | ~0.5m | Close |
| -70 dBm | ~10m | Threshold |
| -80 dBm | ~10-15m | Too far |
| -95 dBm | ~35m | No bystander |

### Deployment Note
Full BLE requires OS-level support (similar to Apple/Google COVID EN framework) for zero-install bystander notification. Current implementation validates the proximity detection logic through simulation, pending platform adoption.

---

## Component 5: LLM Instruction Generator

### Architecture

**System prompt (fixed):**
Constrains LLM to AHA-compliant, medication-free, plain-language output in ≤5 numbered steps. Temperature = 0.1 for deterministic, safe outputs.

**Context prompt (dynamic, built at runtime):**
```
Event: {fall / arrhythmia / fall_and_arrhythmia}
Severity: {LOW / MEDIUM / HIGH} with description
Patient age range: {elderly}
Detection confidence: Fall {X}%, Arrhythmia {Y}%
Bystander status: {present nearby / alone}
```

**Model:** llama-3.3-70b-versatile via Groq API
**Planned upgrade:** Gemma 2B INT4 on-device via MediaPipe

### Instruction Differentiation

The LLM correctly differentiates by scenario:

| Event | Key Differentiator |
|-------|-------------------|
| Fall only | Spinal precautions, bleeding management |
| Arrhythmia only | CPR readiness, dispatcher instructions |
| Fall + Arrhythmia | Cardiac-priority, AED included |

---

## Component 6: Response Layer

### Actor Information Matrix

| Actor | PENDING | ACTIVE | ESCALATING | RESOLVED |
|-------|---------|--------|------------|----------|
| Patient | Vibrate | Audio alarm | Audio alarm | Dismiss |
| Bystander | — | LLM instructions | LLM instructions | Dismiss |
| Responder | — | — | Event summary | Acknowledge |

### Mock Actor Behavior (Simulation)

**MockBystander:**
- `response_prob`: probability of responding (default 0.75)
- `response_delay`: simulated reaction time in seconds
- Probabilistic — models real-world bystander behavior variability

**MockResponder:**
- Always acknowledges (represents professional responder)
- `ack_delay`: simulated dispatch time

---

## Data Flow Diagram

```
Sensor Window (every ~1 second)
         │
         ▼
┌─────────────────────┐
│   detect_fall()     │──→ fall_prob: 0.0-1.0
│   detect_arrhy()    │──→ arrhy_prob: 0.0-1.0
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ classify_severity() │──→ "NONE" | "LOW" | "MEDIUM" | "HIGH"
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ engine.process()    │──→ {state, alert, notify_bystander, call_responder}
└─────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
BLE scan   (if ACTIVE)
    │
    ▼
bystander_nearby?
    │
    ├── YES → generate_instructions() → push to bystander
    │
    └── NO  → wait 60s → escalate → notify responder
```
