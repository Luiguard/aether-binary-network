"""
AETHER BINARY NETWORK - 1B Model QLoRA Training Script
Windows Native Optimized for RTX 3060 Mobile (6GB VRAM)
"""
import torch
import time
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainerCallback
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer, SFTConfig

print(f"CUDA verfügbar: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"Grafikkarte: {torch.cuda.get_device_name(0)}")

# --- THERMAL THROTTLE (Lüfter-Bremse) ---
class ThermalThrottleCallback(TrainerCallback):
    """Pausiert das Training nach jedem Schritt, um die GPU abkühlen zu lassen."""
    def __init__(self, cooldown_seconds=3.0):
        self.cooldown = cooldown_seconds
        
    def on_step_end(self, args, state, control, **kwargs):
        # Zeige Fortschritt und kühle ab
        print(f"\n[THERMAL] Cooling down for {self.cooldown}s...")
        time.sleep(self.cooldown)
# ----------------------------------------

model_id = "Qwen/Qwen1.5-1.8B-Chat"

print("🚀 Lade 1B Modell in 4-Bit Quantisierung für RTX 3060...")

# 1. 4-Bit Config for 6GB VRAM safety
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
)

tokenizer = AutoTokenizer.from_pretrained(model_id)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    model_id,
    quantization_config=bnb_config,
    device_map="auto"
)

# Prepare model for PEFT
model = prepare_model_for_kbit_training(model)

# 2. Add LoRA Adapters (Trainable path)
peft_config = LoraConfig(
    r=32, # Erhöhter Rang für komplexere Logik
    lora_alpha=64,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)
model = get_peft_model(model, peft_config)
model.print_trainable_parameters()

# 3. Load Dataset
print("📚 Lade Aether Binary Dataset...")
def format_prompt(examples):
    instructions = examples["instruction"]
    outputs      = examples["output"]
    texts = []
    for instruction, output in zip(instructions, outputs):
        prompt = f"<|im_start|>system\nDu bist der Aether Binary Compiler. Generiere ausschließlich das 0xAE Array.<|im_end|>\n<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n{output}<|im_end|>"
        texts.append(prompt)
    return { "text" : texts }

dataset = load_dataset("json", data_files="dataset.jsonl", split="train")
dataset = dataset.map(format_prompt, batched = True)

# 4. Training (Deep Insight Mode)
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    processing_class=tokenizer,
    callbacks=[ThermalThrottleCallback(cooldown_seconds=3.0)], 
    args=SFTConfig(
        dataset_text_field="text",
        output_dir="outputs",
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=4000, # Final Boss Training (2048 Beispiele, 4 Stunden)
        learning_rate=1e-4, # Etwas konservativer für 2000 Steps
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=10,
        optim="adamw_8bit",
        report_to="none"
    ),
)

print("⚡ Starte Deep Training auf RTX 3060 (Lüfter-Schonmodus)...")
trainer.train()

print("💾 Speichere das fertig trainierte Deep-Binary-Modell...")
trainer.model.save_pretrained("aether_binary_1b_deep_model")
tokenizer.save_pretrained("aether_binary_1b_deep_model")
print("✅ Mission accomplished. Die KI ist nun tiefen-gelehrt.")
