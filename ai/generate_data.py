import json
import random

def generate_dataset(num_examples=2048):
    components = [
        "Button", "Text", "Image", "Input", "Row", "Col", "Panel", 
        "Nav", "Alert", "Table", "ProgressBar", "Slider", "Form", 
        "Icon", "Grid", "Switch", "VideoPlayer", "Select", "Divider", "Checkbox"
    ]
    colors = ["blue", "red", "green", "purple", "orange", "gold", "gray", "cyan", "magenta"]
    
    dataset = []
    
    for i in range(num_examples):
        # 80% Standard-Tasks, 20% "Herausforderungen" (Extreme Verschachtelung)
        is_challenge = random.random() < 0.2
        
        if not is_challenge:
            case = random.randint(1, 9)
            if case == 1: # Basic Button
                color = random.choice(colors)
                label = random.choice(["Speichern", "Abbrechen", "Senden", "OK", "Start", "Stop"])
                dataset.append({
                    "instruction": f"Erstelle einen {color}en Button mit Text '{label}'",
                    "output": f'[1, "Button", {{"label": "{label}", "color": "{color}"}}]'
                })
            elif case == 2: # Input fields
                label = random.choice(["E-Mail", "Passwort", "Nachricht", "Telefon", "PLZ"])
                dataset.append({
                    "instruction": f"Ein Eingabefeld für {label}",
                    "output": f'[1, "Input", {{"placeholder": "{label}", "id": "inp_{label.lower()}"}}]'
                })
            elif case == 3: # Row/Col
                dataset.append({
                    "instruction": f"Mache eine Reihe mit einem Icon und Text",
                    "output": '[1, "Row", {}, [ [1, "Icon", {"name": "star"}], [1, "Text", {"content": "Favorit"}] ]]'
                })
            elif case == 4: # Progress
                val = random.randint(0, 100)
                dataset.append({
                    "instruction": f"Zeige einen Ladebalken bei {val}%",
                    "output": f'[1, "ProgressBar", {{"val": {val}, "max": 100}}]'
                })
            elif case == 5: # Icons
                name = random.choice(["user", "settings", "home", "search", "bell"])
                dataset.append({
                    "instruction": f"Ein {name} Icon in {random.choice(colors)}",
                    "output": f'[1, "Icon", {{"name": "{name}", "color": "{random.choice(colors)}"}}]'
                })
            elif case == 6: # Badges
                res = random.choice(["CPU", "GPU", "RAM", "BW"])
                dataset.append({
                    "instruction": f"Zeige {res} Limit von 0.3%",
                    "output": f'[1, "Badge", {{"label": "{res}", "value": "0.3%", "color": "cyan"}}]'
                })
            elif case == 7: # Simple Switch
                dataset.append({
                    "instruction": "Einen Switch für Nachtmodus",
                    "output": '[1, "Switch", {"label": "Nachtmodus", "id": "dark_mode"}]'
                })
            elif case == 8: # Divider
                dataset.append({
                    "instruction": "Horizontale Trennlinie",
                    "output": '[1, "Divider", {"type": "hr"}]'
                })
            else: # Checkbox
                dataset.append({
                    "instruction": "Checkbox für AGB",
                    "output": '[1, "Checkbox", {"label": "AGB akzeptieren"}]'
                })
        
        else: # HERAUSFORDERUNGEN (Extreme Verschachtelung & Logik)
            challenge_type = random.randint(1, 4)
            
            if challenge_type == 1: # Komplettes Messenger Layout
                name = random.choice(["Alice", "Bob", "Charlie", "Max"])
                dataset.append({
                    "instruction": f"Herausforderung: Baue ein komplettes Messenger-Fenster für Chat mit {name}",
                    "output": f'[1, "View", {{"id": "msg_view"}}, [ [1, "Nav", {{"title": "Chat: {name}"}}], [1, "List", {{"scroll": true}}, [ [1, "Msg", {{"from": "system", "text": "Verschlüsselt" }}], [1, "Msg", {{"from": "{name}", "text": "Hey!" }}] ]], [1, "Row", {{}}, [ [1, "Input", {{"placeholder": "Text..."}}], [1, "Button", {{"icon": "send"}}] ]] ]]'
                })
            
            elif challenge_type == 2: # Crypto Trading Terminal
                coin = random.choice(["BTC", "AETHER", "ETH"])
                dataset.append({
                    "instruction": f"Herausforderung: Erstelle ein komplexes Trading-Dashboard für {coin}",
                    "output": f'[1, "Col", {{"gap": 10}}, [ [1, "Panel", {{"id": "chart", "height": 200}}, [1, "Graph", {{"src": "{coin}_data"}}] ], [1, "Row", {{}}, [ [1, "Col", {{}}, [ [1, "Text", {{"content": "Orderbook" }}], [1, "Table", {{"rows": 5}}] ]], [1, "Form", {{}}, [ [1, "Input", {{"label": "Menge" }}], [1, "Button", {{"label": "Kaufen", "color": "green"}}], [1, "Button", {{"label": "Verkaufen", "color": "red"}}] ]] ]] ]]'
                })
                
            elif challenge_type == 3: # Multi-Step Form
                dataset.append({
                    "instruction": "Herausforderung: Baue ein 3-stufiges Registrierungsformular (Stepper)",
                    "output": '[1, "Col", {}, [ [1, "Stepper", {"steps": ["Account", "Profil", "Finish"], "active": 1}], [1, "Form", {}, [ [1, "Input", {"placeholder": "Nutzername"}], [1, "Input", {"type": "password", "placeholder": "Passwort"}], [1, "Row", {"align": "right"}, [ [1, "Button", {"label": "Weiter", "color": "blue"}] ]] ]] ]]'
                })
                
            else: # Deep System Settings Grid
                dataset.append({
                    "instruction": "Herausforderung: Erstelle ein tief verschachteltes System-Einstellungs-Menü mit Grid",
                    "output": '[1, "Panel", {"glass": true, "padding": 20}, [ [1, "Text", {"content": "Einstellungen", "style": "h1"}], [1, "Grid", {"cols": 2}, [ [1, "Col", {}, [ [1, "Text", {"content": "Netzwerk"}], [1, "Switch", {"label": "Swarm-P2P"}], [1, "Switch", {"label": "Verschlüsselung"}] ]], [1, "Col", {}, [ [1, "Text", {"content": "Ressourcen"}], [1, "Slider", {"label": "CPU Limit", "val": 0.3}], [1, "Slider", {"label": "RAM Limit", "val": 0.3}] ] ] ]] ]]'
                })

    with open("dataset.jsonl", "w", encoding="utf-8") as f:
        for entry in dataset:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            
    print(f"✅ 0xAE Datensatz (inkl. Herausforderungen) erfolgreich generiert: {len(dataset)} Beispiele")

if __name__ == "__main__":
    generate_dataset(2048)
