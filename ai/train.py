"""
AETHER BINARY NETWORK - 1B Model QLoRA Training Script
Optimized for RTX 3060 Mobile (6GB VRAM) using Unsloth.
"""

# Install requirements before running:
# pip install "unsloth[cu121-torch230] @ git+https://github.com/unslothai/unsloth.git"
# pip install trl peft datasets

import torch
from datasets import load_dataset
from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

# 1. Config (Fit for 6GB VRAM RTX 3060)
max_seq_length = 512 # Keep it short for binary protocol tokens
dtype = None         # Auto-detection
load_in_4bit = True  # Magical 4-bit quantization (Saves 60% VRAM)

print("🚀 Lade 1B Modell in 4-Bit für RTX 3060...")

# Use a fast 1B-1.5B model (e.g., Qwen 1.5 1.8B or TinyLlama 1.1B)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "Qwen/Qwen1.5-1.8B-Chat",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

# 2. Add LoRA Adapters (Only train 1-2% of parameters)
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, 
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0, 
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)

# 3. Load Binary Protocol Dataset
print("📚 Lade Aether Binary Dataset...")
# Formatter function
def format_prompt(examples):
    instructions = examples["instruction"]
    outputs      = examples["output"]
    texts = []
    for instruction, output in zip(instructions, outputs):
        # We tell the AI clearly what its job is
        prompt = f"<|im_start|>system\nDu bist der Aether Binary Compiler. Generiere ausschließlich das 0xAE Array.<|im_end|>\n<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n{output}<|im_end|>"
        texts.append(prompt)
    return { "text" : texts }

dataset = load_dataset("json", data_files="dataset.jsonl", split="train")
dataset = dataset.map(format_prompt, batched = True)

# 4. Training Setup (Optimized for Laptop GPU)
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    args = TrainingArguments(
        per_device_train_batch_size = 2, # Small batch for 6GB VRAM
        gradient_accumulation_steps = 4, # Simulate larger batch size
        warmup_steps = 10,
        max_steps = 200, # For the PoC. Real training needs more steps.
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 5,
        optim = "adamw_8bit",            # 8-bit Adam to save even more RAM
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

print("⚡ Starte Training auf RTX 3060...")
trainer_stats = trainer.train()

# 5. Save the Fine-Tuned Brain
print("💾 Speichere das fertig trainierte Binary Modell...")
model.save_pretrained("aether_binary_1b_model")
tokenizer.save_pretrained("aether_binary_1b_model")

print("✅ Training abgeschlossen. Die 1B-KI spricht nun fließend das Aether-Binärprotokoll.")
