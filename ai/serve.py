"""
AETHER BINARY AI – Inference Server
Loads the fine-tuned LoRA model and serves it via HTTP API.
Runs alongside the Node.js server on port 5050.
"""

import torch
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

MODEL_ID = "Qwen/Qwen1.5-1.8B-Chat"
ADAPTER_PATH = "aether_binary_1b_deep_model"
PORT = 5050

print("🧠 Aether Binary AI – Inference Server")
print(f"   GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")

# Load base model in 4-bit
print("📦 Lade Basis-Modell (4-Bit)...")
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16
)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

base_model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb_config,
    device_map="auto"
)

# Load fine-tuned LoRA adapter
print(f"🔌 Lade LoRA Adapter: {ADAPTER_PATH}")
model = PeftModel.from_pretrained(base_model, ADAPTER_PATH)
model.eval()
print("✅ Modell geladen und bereit!")

SYSTEM_PROMPT = "Du bist der Aether Binary Compiler. Generiere ausschließlich das 0xAE Array."

def generate(prompt, max_tokens=512):
    """Generate binary AST from a user prompt."""
    messages = f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
    
    inputs = tokenizer(messages, return_tensors="pt").to(model.device)
    
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=0.3,
            top_p=0.9,
            do_sample=True,
            repetition_penalty=1.1,
            pad_token_id=tokenizer.pad_token_id
        )
    
    response = tokenizer.decode(outputs[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
    return response.strip()


class InferenceHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/generate':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            prompt = body.get('prompt', '')
            
            if not prompt:
                self._respond(400, {"error": "No prompt provided"})
                return
            
            try:
                result = generate(prompt)
                # Try to parse as JSON array to validate
                try:
                    parsed = json.loads(result)
                    self._respond(200, {"ast": parsed, "raw": result, "valid": True})
                except json.JSONDecodeError:
                    self._respond(200, {"ast": None, "raw": result, "valid": False})
            except Exception as e:
                self._respond(500, {"error": str(e)})
        else:
            self._respond(404, {"error": "Not found"})
    
    def do_GET(self):
        if self.path == '/health':
            self._respond(200, {"status": "ok", "model": MODEL_ID, "adapter": ADAPTER_PATH})
        else:
            self._respond(404, {"error": "Not found"})
    
    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        print(f"[AI] {args[0]}")


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), InferenceHandler)
    print(f"\n🌐 AI Inference Server läuft auf http://localhost:{PORT}")
    print(f"   POST /generate  {{ \"prompt\": \"Baue einen Login\" }}")
    print(f"   GET  /health")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[AI] Server beendet.")
