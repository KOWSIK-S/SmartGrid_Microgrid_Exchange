from flask import Flask, request, jsonify, render_template
from pymongo import MongoClient
import bcrypt
import datetime
import random

app = Flask(__name__)

# Connect to your local MongoDB instance.
client = MongoClient("mongodb://localhost:27017")
db = client.indian_energy_exchange
user_profiles_collection = db.user_profiles
user_authentications_collection = db.user_authentications

def generate_user_id() -> str:
    """Generate a unique user_id in the form 'U1234'."""
    while True:
        user_id = f"U{random.randint(1000, 9999)}"
        # Check if this user_id already exists in the user_profiles collection.
        if user_profiles_collection.find_one({"user_id": user_id}) is None:
            return user_id

def hash_password(password: str) -> str:
    """Hash a password using bcrypt which automatically salts."""
    # bcrypt.gensalt() generates a salt and applies a cost factor.
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(stored_hash: str, provided_password: str) -> bool:
    """Verify a provided password using bcrypt."""
    return bcrypt.checkpw(provided_password.encode('utf-8'), stored_hash.encode('utf-8'))

@app.route('/')
def index():
    # Serve the front-end HTML page.
    return render_template('index.html')

@app.route('/signup', methods=['POST'])
def signup():
    data = request.get_json()
    # Extract data sent from the front-end
    name = data.get('name')
    user_category = data.get('user_category')
    user_type = data.get('user_type') if user_category == "User" else ""
    location = data.get('location') if user_category == "User" else ""
    eco_index = data.get('eco_index')
    password = data.get('password')
    captcha_answer = data.get('captcha_answer')
    client_captcha = data.get('client_captcha')  # Expected answer provided by client
    
    # Validate captcha (here we simply compare the numbers)
    try:
        if int(captcha_answer) != int(client_captcha):
            return jsonify({"status": "error", "message": "Captcha verification failed"}), 400
    except ValueError:
        return jsonify({"status": "error", "message": "Invalid captcha input"}), 400

    # Validate required fields (for simplicity, only basic validation)
    if not all([name, user_category, eco_index, password]):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    # Generate a unique user_id and get the current time (ISO 8601)
    user_id = generate_user_id()
    created_on = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # Create user_profile document
    user_profile = {
        "user_id": user_id,
        "name": name,
        "user_category": user_category,         # Allowed: ["Admin", "User"]
        "user_type": user_type,                 # Allowed: ["Individual", "Organisation"] – empty for admins
        "location": location,                   # Empty for admins
        "created_on": created_on,
        "eco_index": eco_index,                 # Allowed: ["A", "B", "C", "D", "E", "F", "G"]
        "linked_infrastructures": []            # Initially empty
    }
    # Insert into MongoDB
    user_profiles_collection.insert_one(user_profile)

    # Hash the password and create user_authentication document
    hashed_pw = hash_password(password)
    user_auth = {
        "user_id": user_id,
        "password": {
            "current_hash": hashed_pw,
            "updates": [],  # Future updates can be appended here.
            "last_updated": created_on
        }
    }
    user_authentications_collection.insert_one(user_auth)

    # Return success response along with the user profile details.
    return jsonify({"status": "success", "message": f"Welcome, {name}!", "user_profile": user_profile})

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = data.get('identifier')
    password = data.get('password')

    if not identifier or not password:
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    # For simplicity, we assume identifier is the user_id.
    user_auth = user_authentications_collection.find_one({"user_id": identifier})
    if not user_auth:
        return jsonify({"status": "error", "message": "User does not exist"}), 400

    stored_hash = user_auth["password"]["current_hash"]
    if verify_password(stored_hash, password):
        return jsonify({"status": "success", "message": "Login successful"})
    else:
        return jsonify({"status": "error", "message": "Invalid password"}), 400

if __name__ == '__main__':
    app.run(debug=True)
