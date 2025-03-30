from flask import Flask, request, jsonify, render_template
import hashlib, os, datetime, random

app = Flask(__name__)

# In-memory "databases" to simulate MongoDB collections.
user_profiles = {}         # key: user_id, value: profile document
user_authentications = {}  # key: user_id, value: authentication document

def generate_user_id() -> str:
    """Generate a unique user_id in the form 'U1234'."""
    while True:
        user_id = f"U{random.randint(1000, 9999)}"
        if user_id not in user_profiles:
            return user_id

def hash_password(password: str) -> dict:
    """Hash a password using PBKDF2-HMAC-SHA256 with a random salt."""
    salt = os.urandom(16)  # 16-byte random salt
    iterations = 100000    # Work factor for security
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return {
        'current_hash': hashed.hex(),
        'salt': salt.hex(),
        'iterations': iterations,
        'last_updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'updates': []
    }

def verify_password(stored_data: dict, provided_password: str) -> bool:
    """Verify a provided password against the stored authentication data."""
    salt = bytes.fromhex(stored_data['salt'])
    iterations = stored_data['iterations']
    stored_hash = stored_data['current_hash']
    new_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt, iterations)
    return new_hash.hex() == stored_hash

@app.route('/')
def index():
    # Serve the front-end HTML page.
    return render_template('index.html')

@app.route('/signup', methods=['POST'])
def signup():
    data = request.get_json()
    # Extract fields from the incoming JSON payload.
    name = data.get('name')
    user_category = data.get('user_category')
    user_type = data.get('user_type') if user_category == "User" else ""
    location = data.get('location') if user_category == "User" else ""
    eco_index = data.get('eco_index')
    password = data.get('password')
    captcha_answer = data.get('captcha_answer')
    client_captcha = data.get('client_captcha')  # expected answer provided by client
    
    # (Captcha validation would normally be done on the server too.)
    if int(captcha_answer) != int(client_captcha):
        return jsonify({"status": "error", "message": "Captcha verification failed"}), 400
    
    # Validate required fields.
    if not all([name, user_category, eco_index, password]):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
    
    # Generate a unique user_id.
    user_id = generate_user_id()
    created_on = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    # Create the user_profile document.
    user_profile = {
        "user_id": user_id,
        "name": name,
        "user_category": user_category,  # Allowed: ["Admin", "User"]
        "user_type": user_type,          # Allowed: ["Individual", "Organisation"] – empty for admins
        "location": location,            # empty for admins
        "created_on": created_on,
        "eco_index": eco_index,          # Allowed: ["A", "B", "C", "D", "E", "F", "G"]
        "linked_infrastructures": []     # Initially empty
    }
    user_profiles[user_id] = user_profile
    
    # Create the user_authentication document.
    password_data = hash_password(password)
    user_auth = {
        "user_id": user_id,
        "password": password_data
    }
    user_authentications[user_id] = user_auth
    
    # For demonstration, return a welcome message with the user's profile.
    return jsonify({"status": "success", "message": f"Welcome, {name}!", "user_profile": user_profile})

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = data.get('identifier')
    password = data.get('password')
    
    # For this demo, we assume the identifier is the user_id.
    # In a full implementation, you might search by name or linked infrastructure.
    if not identifier or not password:
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
    
    user_auth = user_authentications.get(identifier)
    if not user_auth:
        return jsonify({"status": "error", "message": "User does not exist"}), 400

    if verify_password(user_auth["password"], password):
        return jsonify({"status": "success", "message": "Login successful"})
    else:
        return jsonify({"status": "error", "message": "Invalid password"}), 400

if __name__ == '__main__':
    app.run(debug=True)
