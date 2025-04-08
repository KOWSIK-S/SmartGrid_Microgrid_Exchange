/*********************************************
 * app.js - Improved Realistic Application
 * for User & Admin Infrastructure Management,
 * Indian Energy Exchange with Real-Time Data,
 * Admin & Bidding Dashboard, and Enhanced Signup
 *********************************************/

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
const port = 3000;

// -------------------------
// 1) Connect to MongoDB (database "mydb")
mongoose.connect('mongodb://localhost:27017/mydb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB successfully.");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// -------------------------
// 2) Define Schemas & Models

// User Profile Schema
const userSchema = new mongoose.Schema({
  user_id: { type: String, unique: true },
  name: String,
  email_id: String,
  user_category: { type: String, enum: ["Admin", "User"] },
  user_type: String, // empty for admins
  location: String,  // empty for admins
  created_on: Date,
  eco_index: { type: String, enum: ["A","B","C","D","E","F","G"] },
  linked_infrastructures: { type: [String], default: [] }
});
const User = mongoose.model('User', userSchema);

// User Authentication Schema
const userAuthSchema = new mongoose.Schema({
  user_id: { type: String, unique: true },
  password: {
    current_hash: String,
    salt: String,
    iterations: Number,
    updates: [{
      hash: String,
      updated_at: Date
    }],
    last_updated: Date
  }
});
const UserAuth = mongoose.model('UserAuth', userAuthSchema);

// Infrastructure Registration Schema
const infrastructureSchema = new mongoose.Schema({
  infrastructure_id: { type: String, unique: true },
  user_id: String, // Owner (for non-admins)
  infrastructure_category: { type: String, enum: ["Producer", "Consumer", "AncillaryStabilizers"] },
  infrastructure_type: { type: String, enum: ["Residential", "Industrial", "NGO", "Govt", "Public"] },
  location: String,
  load_demand: {
    value: Number,
    updated_on: Date,
    stage: { type: String, enum: ["Registered", "Cleared", "Under Review", "Suspended"] , default: "Registered" },
    registration_status: { type: String, enum: ["Approved", "Rejected", "Pending", "Under Review"] , default: "Pending" },
    status_history: [{
      timestamp: Date,
      status: { type: String, enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction"] },
      updated_by: String
    }]
  },
  eco_index: { type: String, enum: ["A", "B", "C", "D", "E", "F", "G"] },
  region: { type: String, enum: ["Central", "Southern", "Eastern", "High Province"] },
  infrastructure_status: {
    stage: { type: String, enum: ["Registered", "Cleared", "Under Review", "Suspended", "Updated"], default: "Registered" },
    registration_status: { type: String, enum: ["Approved", "Rejected", "Pending", "Under Review"], default: "Pending" },
    status_history: [{
      timestamp: Date,
      status: { type: String, enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction"] },
      updated_by: String
    }]
  },
  priority: {
    priority_index: String,  // "1" to "100"
    Timestamp: Date,
    updated_by: String
  }
});
const Infrastructure = mongoose.model('Infrastructure', infrastructureSchema);

// Real-Time Infrastructure Data Schema
const realTimeInfraSchema = new mongoose.Schema({
  infrastructure_id: { type: String, unique: true },
  real_time_data: [{
    status: { type: String, enum: ["Active", "Qualified-Inactive", "Suspended", "Under Review", "Access", "Offline"] },
    data_timestamp: Date,
    voltage: Number,
    current: Number
  }]
});
const RealTimeInfra = mongoose.model('RealTimeInfra', realTimeInfraSchema);

// Bidding Schema
const bidSchema = new mongoose.Schema({
  bid_id: { type: String, unique: true },
  infrastructure_id: String,
  bid_round: { type: String, enum: ["Day-Ahead", "15-Min", "Compensation"] },
  bid_price: mongoose.Schema.Types.Mixed, // array or single value
  bid_value: mongoose.Schema.Types.Mixed,
  bid_submitted_timestamp: Date,
  bid_updates: [{
    stage: { type: String, enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction", "Compensatation"] },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"] },
    timestamp: Date,
    Allocated: mongoose.Schema.Types.Mixed,
    Price: mongoose.Schema.Types.Mixed
  }]
});
const Bid = mongoose.model('Bid', bidSchema);

// Billing Schema
const billingSchema = new mongoose.Schema({
  billing_id: { type: String, unique: true },
  infrastructure_id: String,
  billed_day: String,
  daily_billing_updates: [{
    bid_id: String,
    billing_round: { type: String, enum: ["Day-Ahead", "15-Min", "After Consumption"] },
    billing_amount: mongoose.Schema.Types.Mixed,
    billed_at: Date
  }],
  Credit: String
});
const Billing = mongoose.model('Billing', billingSchema);

// Wallet & Transactions Schema
const walletSchema = new mongoose.Schema({
  user_id: { type: String, unique: true },
  wallet: {
    balance: Number,
    transactions: [{
      transaction_id: String,
      transaction_category: { type: String, enum: ["Credit", "Debit"] },
      transaction_status: { type: String, enum: ["Pending", "Completed", "Canceled"] },
      transaction_amount: Number,
      updated_wallet_amount: Number,
      timestamp: Date
    }]
  }
});
const Wallet = mongoose.model('Wallet', walletSchema);

// Market Performance Reports Schema
const marketReportSchema = new mongoose.Schema({
  report_id: { type: String, unique: true },
  report_date: String,
  market_type: { type: String, enum: ["Day-Ahead", "15-Min"] },
  average_clearing_price: Number,
  total_energy_traded_MWh: Number,
  losses_percent: Number,
  notes: String
});
const MarketReport = mongoose.model('MarketReport', marketReportSchema);

// Notifications & Alerts Schema
const notificationSchema = new mongoose.Schema({
  notification_id: { type: String, unique: true },
  user_id: String,
  infrastructure_id: String,
  notification_type: { type: String, enum: ["Bid Update", "Status Change", "Billing Alert", "Compliance Reminder"] },
  message: String,
  created_on: Date,
  read: Boolean
});
const Notification = mongoose.model('Notification', notificationSchema);

// Audit Log Schema
const auditLogSchema = new mongoose.Schema({
  log_id: { type: String, unique: true },
  entity_type: { type: String, enum: ["UserReg", "InfrastructureReg", "Bid", "Billing", "Transaction"] },
  entity_id: String,
  action: String,
  details: String,
  timestamp: Date,
  performed_by: String,
  IPv4_Address: String,
  IPv6_Address: String,
  IP_Location: String,
  Host_Name: String,
  Proxy: String,
  Device_Type: String,
  OS: String,
  Browser: String,
  User_Agent: String,
  Screen_Size: String
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// -------------------------
// 3) Utility Functions

function letterToNumber(letter) {
  const mapping = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7 };
  return mapping[letter.toUpperCase()] || 0;
}
function numberToLetter(num) {
  num = Math.round(Math.max(1, Math.min(7, num)));
  const mapping = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G' };
  return mapping[num];
}
async function updateUserEcoIndex(user_id) {
  try {
    const user = await User.findOne({ user_id });
    if (!user || user.user_category === "Admin") return;
    const infrastructures = await Infrastructure.find({ user_id });
    if (!infrastructures || infrastructures.length === 0) {
      user.eco_index = "B";
      await user.save();
      return;
    }
    let total = 0;
    infrastructures.forEach(infra => {
      total += letterToNumber(infra.eco_index);
    });
    const avg = total / infrastructures.length;
    user.eco_index = numberToLetter(avg);
    await user.save();
  } catch (err) {
    console.error('Error updating user eco index:', err);
  }
}
function getCurrentTime() {
  return new Date().toISOString();
}

// Password hashing using PBKDF2-HMAC with SHA-256
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const iterations = 100000;
  const keylen = 64;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return { hash, salt, iterations };
}

// -------------------------
// 4) Express & Body-Parser Setup
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------------
// 5) Landing Page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Welcome</title></head>
      <body>
        <h1>Welcome to Indian Energy Exchange</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <p>Choose an option:</p>
        <ul>
          <li><a href="/signup">Sign Up</a></li>
          <li><a href="/signin">Sign In</a></li>
          <li><a href="/forgot">Forgot Password</a></li>
          <li><a href="/initdb">Init Sample Data</a> (Run once)</li>
        </ul>
      </body>
    </html>
  `);
});

// -------------------------
// 6) Signup (User & Admin) with Password Strength, Confirmation & Captcha
app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sign Up</title>
        <style>
          .hidden { display: none; }
          .strength { font-weight: bold; }
        </style>
        <script>
          function checkCategory() {
            var category = document.getElementById("user_category").value;
            var typeField = document.getElementById("user_type_field");
            var locationField = document.getElementById("location_field");
            if (category === "Admin") {
              typeField.style.display = "none";
              locationField.style.display = "none";
            } else {
              typeField.style.display = "block";
              locationField.style.display = "block";
            }
          }
          function checkStrength() {
            var pwd = document.getElementById("password").value;
            var strengthEl = document.getElementById("strength");
            var strength = "Weak";
            if(pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[!@#\\$%\\^&\\*]/.test(pwd)) {
              strength = "Strong";
            } else if(pwd.length >= 6) {
              strength = "Medium";
            }
            strengthEl.textContent = strength;
          }
          function generateCaptcha() {
            var a = Math.floor(Math.random() * 10);
            var b = Math.floor(Math.random() * 10);
            document.getElementById("captchaText").textContent = a + " + " + b + " = ?";
            document.getElementById("captchaAnswer").value = a + b;
          }
          window.onload = function() {
            checkCategory();
            generateCaptcha();
          }
        </script>
      </head>
      <body>
        <h1>Sign Up</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <form method="POST" action="/signup">
          <label>Name:</label><br>
          <input type="text" name="name" required><br><br>
          <label>Email ID:</label><br>
          <input type="email" name="email_id" required><br><br>
          <label>User Category:</label><br>
          <select name="user_category" id="user_category" onchange="checkCategory()" required>
            <option value="User">User</option>
            <option value="Admin">Admin</option>
          </select><br><br>
          <div id="user_type_field">
            <label>User Type:</label><br>
            <select name="user_type">
              <option value="Individual">Individual</option>
              <option value="Organisation">Organisation</option>
            </select><br><br>
          </div>
          <div id="location_field">
            <label>Location:</label><br>
            <input type="text" name="location"><br><br>
          </div>
          <label>Eco Credit (A-G):</label><br>
          <select name="eco_index" required>
            <option value="A">A</option>
            <option value="B" selected>B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
            <option value="F">F</option>
            <option value="G">G</option>
          </select><br><br>
          <label>Password:</label><br>
          <input type="password" name="password" id="password" onkeyup="checkStrength()" required><br>
          <span>Password Strength: <span id="strength" class="strength">Weak</span></span><br><br>
          <label>Confirm Password:</label><br>
          <input type="password" name="confirm_password" required><br><br>
          <div>
            <span id="captchaText"></span><br>
            <input type="text" name="captcha_input" placeholder="Enter sum" required>
            <input type="hidden" id="captchaAnswer" name="captcha_answer">
          </div><br>
          <button type="submit">Sign Up</button>
        </form>
        <br><a href="/">Back to Home</a>
      </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { name, email_id, user_category, user_type, location, eco_index, password, confirm_password, captcha_input, captcha_answer } = req.body;
  if(password !== confirm_password) return res.send('Passwords do not match.');
  if(Number(captcha_input) !== Number(captcha_answer)) return res.send('Captcha incorrect. Please try again.');
  
  const user_id = "U" + crypto.randomBytes(3).toString('hex').toUpperCase();
  const created_on = new Date();
  
  // Hash the password using PBKDF2
  const { hash, salt, iterations } = hashPassword(password);
  
  let finalUserType = (user_category === "Admin") ? "" : user_type;
  let finalLocation = (user_category === "Admin") ? "" : location;
  
  const newUser = new User({
    user_id,
    name,
    email_id,
    user_category,
    user_type: finalUserType,
    location: finalLocation,
    created_on,
    eco_index,
    linked_infrastructures: []
  });
  
  const newUserAuth = new UserAuth({
    user_id,
    password: {
      current_hash: hash,
      salt: salt,
      iterations: iterations,
      updates: [],
      last_updated: created_on
    }
  });
  
  try {
    await newUser.save();
    await newUserAuth.save();
    res.redirect(`/home?user_id=${user_id}`);
  } catch (err) {
    console.error(err);
    res.send('Error during signup.');
  }
});

// -------------------------
// 7) Sign In
app.get('/signin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Sign In</title></head>
      <body>
        <h1>Sign In</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <form method="POST" action="/signin">
          <label>User ID:</label><br>
          <input type="text" name="user_id" required><br><br>
          <label>Password:</label><br>
          <input type="password" name="password" required><br><br>
          <button type="submit">Sign In</button>
        </form>
        <br>
        <a href="/">Back to Home</a> | <a href="/forgot">Forgot Password?</a>
      </body>
    </html>
  `);
});

app.post('/signin', async (req, res) => {
  const { user_id, password } = req.body;
  try {
    const userAuth = await UserAuth.findOne({ user_id });
    if(!userAuth) return res.send('User not found.');
    const { salt, iterations, current_hash } = userAuth.password;
    const hashAttempt = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha256').toString('hex');
    if(hashAttempt !== current_hash) return res.send('Incorrect password.');
    res.redirect(`/home?user_id=${user_id}`);
  } catch(err) {
    console.error(err);
    res.send('Error during sign in.');
  }
});

// -------------------------
// 8) Forgot Password
app.get('/forgot', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Forgot Password</title></head>
      <body>
        <h1>Forgot Password</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <form method="POST" action="/forgot">
          <label>User ID:</label><br>
          <input type="text" name="user_id" required><br><br>
          <label>New Password:</label><br>
          <input type="password" name="new_password" required><br><br>
          <label>Confirm New Password:</label><br>
          <input type="password" name="confirm_new_password" required><br><br>
          <button type="submit">Update Password</button>
        </form>
        <br><a href="/">Back to Home</a>
      </body>
    </html>
  `);
});

app.post('/forgot', async (req, res) => {
  const { user_id, new_password, confirm_new_password } = req.body;
  if(new_password !== confirm_new_password) return res.send('Passwords do not match.');
  try {
    const userAuth = await UserAuth.findOne({ user_id });
    if(!userAuth) return res.send('User not found.');
    const { salt, iterations } = hashPassword(new_password); // new salt and iterations
    const newHash = crypto.pbkdf2Sync(new_password, salt, iterations, 64, 'sha256').toString('hex');
    userAuth.password.updates.push({ hash: userAuth.password.current_hash, updated_at: new Date() });
    userAuth.password.current_hash = newHash;
    userAuth.password.salt = salt;
    userAuth.password.iterations = iterations;
    userAuth.password.last_updated = new Date();
    await userAuth.save();
    res.send('Password updated. <a href="/signin">Sign In</a>');
  } catch(err) {
    console.error(err);
    res.send('Error updating password.');
  }
});

// -------------------------
// 9) Home Page (User & Admin)
app.get('/home', async (req, res) => {
  const user_id = req.query.user_id;
  if(!user_id) return res.send("No user ID provided.");
  try {
    const user = await User.findOne({ user_id });
    if(!user) return res.send("User not found.");
    let ecoIndexHTML = "";
    if(user.user_category !== "Admin" && user.eco_index) {
      ecoIndexHTML = `<p><strong>Eco Index:</strong> ${user.eco_index}</p>`;
    }
    let linkHTML = "";
    if(user.user_category === "User") {
      linkHTML = `<a href="/infrastructure?user_id=${user_id}">Manage Infrastructures</a> | `;
    } else if(user.user_category === "Admin") {
      linkHTML = `<a href="/admin/dashboard?user_id=${user_id}">Admin Dashboard</a> | `;
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Home</title></head>
        <body>
          <h1>Welcome, ${user.name}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          <p><strong>User ID:</strong> ${user.user_id}</p>
          <p><strong>Email ID:</strong> ${user.email_id || 'N/A'}</p>
          <p><strong>User Category:</strong> ${user.user_category}</p>
          ${user.user_category !== "Admin" ? `<p><strong>User Type:</strong> ${user.user_type}</p><p><strong>Location:</strong> ${user.location}</p>` : ""}
          <p><strong>Created On:</strong> ${user.created_on.toISOString()}</p>
          ${ecoIndexHTML}
          <br>
          ${linkHTML}
          <a href="/signin">Sign Out</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send("Error retrieving home page.");
  }
});

// -------------------------
// 10) Non-Admin Infrastructure Management
// Middleware: only non-admin users allowed.
async function requireUser(req, res, next) {
  const user_id = req.query.user_id || req.body.user_id;
  if(!user_id) return res.send("Access denied: no user id provided.");
  const user = await User.findOne({ user_id });
  if(!user) return res.send("User not found.");
  if(user.user_category !== "User") return res.send("Access denied: Only non-admin users can do this.");
  req.user = user;
  next();
}

app.get('/infrastructure', requireUser, async (req, res) => {
  const user_id = req.user.user_id;
  const infrastructures = await Infrastructure.find({ user_id });
  let infraListHtml = "<h2>Your Infrastructures</h2>";
  if(infrastructures.length === 0) {
    infraListHtml += "<p>No infrastructures registered yet.</p>";
  } else {
    infraListHtml += "<ul>";
    for(const infra of infrastructures) {
      let realTimeDoc = await RealTimeInfra.findOne({ infrastructure_id: infra.infrastructure_id });
      let rtStatus = "No data", rtVoltage = "NaN", rtCurrent = "NaN";
      if(realTimeDoc && realTimeDoc.real_time_data && realTimeDoc.real_time_data.length > 0) {
        realTimeDoc.real_time_data.sort((a, b) => b.data_timestamp - a.data_timestamp);
        const latest = realTimeDoc.real_time_data[0];
        const diffMs = new Date() - latest.data_timestamp;
        const diffMin = diffMs / 60000;
        rtStatus = diffMin > 1 ? "Offline" : latest.status;
        rtVoltage = latest.voltage;
        rtCurrent = latest.current;
      }
      infraListHtml += `<li>
        <a href="/infrastructure/view?user_id=${user_id}&infrastructure_id=${infra.infrastructure_id}">
          ${infra.infrastructure_id}
        </a> (${infra.infrastructure_category}, ${infra.infrastructure_type})
         - RT: ${rtStatus}, Voltage: ${rtVoltage}, Current: ${rtCurrent}
      </li>`;
    }
    infraListHtml += "</ul>";
  }
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Manage Infrastructures</title>
        <meta http-equiv="refresh" content="1">
      </head>
      <body>
        <h1>Manage Infrastructures</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        ${infraListHtml}
        <h3>Add New Infrastructure</h3>
        <form method="POST" action="/infrastructure/add">
          <input type="hidden" name="user_id" value="${user_id}">
          <label>Infrastructure Category:</label><br>
          <select name="infrastructure_category" required>
            <option value="Producer">Producer</option>
            <option value="Consumer">Consumer</option>
            <option value="AncillaryStabilizers">AncillaryStabilizers</option>
          </select><br><br>
          <label>Infrastructure Type:</label><br>
          <select name="infrastructure_type" required>
            <option value="Residential">Residential</option>
            <option value="Industrial">Industrial</option>
            <option value="NGO">NGO</option>
            <option value="Govt">Govt</option>
            <option value="Public">Public</option>
          </select><br><br>
          <label>Location:</label><br>
          <input type="text" name="location" required><br><br>
          <label>Load Demand Value:</label><br>
          <input type="number" name="load_value" required><br><br>
          <label>Eco Credit (A-G):</label><br>
          <select name="eco_index" required>
            <option value="A">A</option>
            <option value="B" selected>B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
            <option value="F">F</option>
            <option value="G">G</option>
          </select><br><br>
          <label>Region:</label><br>
          <select name="region" required>
            <option value="Central">Central</option>
            <option value="Southern">Southern</option>
            <option value="Eastern">Eastern</option>
            <option value="High Province">High Province</option>
          </select><br><br>
          <button type="submit">Add Infrastructure</button>
        </form>
        <br><br>
        <a href="/home?user_id=${user_id}">Back to Home</a>
      </body>
    </html>
  `);
});

app.post('/infrastructure/add', requireUser, async (req, res) => {
  const { user_id, infrastructure_category, infrastructure_type, location, load_value, eco_index, region } = req.body;
  const infrastructure_id = "INF" + crypto.randomBytes(3).toString('hex').toUpperCase();
  const now = new Date();
  const initialHistory = {
    timestamp: now,
    status: "Submitted",
    updated_by: user_id
  };
  const newInfra = new Infrastructure({
    infrastructure_id,
    user_id,
    infrastructure_category,
    infrastructure_type,
    location,
    load_demand: {
      value: Number(load_value),
      updated_on: now,
      stage: "Registered",
      registration_status: "Pending",
      status_history: [initialHistory]
    },
    eco_index,
    region,
    infrastructure_status: {
      stage: "Registered",
      registration_status: "Pending",
      status_history: [initialHistory]
    }
  });
  try {
    await newInfra.save();
    await User.findOneAndUpdate({ user_id }, { $push: { linked_infrastructures: infrastructure_id } });
    await updateUserEcoIndex(user_id);
    res.redirect(`/infrastructure?user_id=${user_id}`);
  } catch(err) {
    console.error(err);
    res.send('Error adding infrastructure.');
  }
});

app.get('/infrastructure/view', requireUser, async (req, res) => {
  const user_id = req.query.user_id;
  const infra_id = req.query.infrastructure_id;
  if(!infra_id) return res.send("No infrastructure_id provided.");
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id: infra_id, user_id });
    if(!infra) return res.send("Infrastructure not found for this user.");
    let realTimeDoc = await RealTimeInfra.findOne({ infrastructure_id: infra_id });
    let rtStatus = "No data", rtVoltage = "NaN", rtCurrent = "NaN", rtTimestamp = "N/A";
    if(realTimeDoc && realTimeDoc.real_time_data && realTimeDoc.real_time_data.length > 0) {
      realTimeDoc.real_time_data.sort((a, b) => b.data_timestamp - a.data_timestamp);
      const latest = realTimeDoc.real_time_data[0];
      const diffMs = new Date() - latest.data_timestamp;
      const diffMin = diffMs / 60000;
      rtStatus = diffMin > 1 ? "Offline" : latest.status;
      rtVoltage = latest.voltage;
      rtCurrent = latest.current;
      rtTimestamp = latest.data_timestamp.toISOString();
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Infrastructure Details</title></head>
        <body>
          <h1>Infrastructure: ${infra.infrastructure_id}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          <p><strong>Category:</strong> ${infra.infrastructure_category}</p>
          <p><strong>Type:</strong> ${infra.infrastructure_type}</p>
          <p><strong>Location:</strong> ${infra.location}</p>
          <p><strong>Eco Credit:</strong> ${infra.eco_index}</p>
          <p><strong>Load Demand:</strong> ${infra.load_demand.value}</p>
          <p><strong>Status Stage:</strong> ${infra.infrastructure_status.stage}</p>
          <p><strong>Registration Status:</strong> ${infra.infrastructure_status.registration_status}</p>
          <h3>Real-Time Data</h3>
          <p><strong>Status:</strong> ${rtStatus}</p>
          <p><strong>Timestamp:</strong> ${rtTimestamp}</p>
          <p><strong>Voltage:</strong> ${rtVoltage}</p>
          <p><strong>Current:</strong> ${rtCurrent}</p>
          <br>
          <h4>Remove This Infrastructure?</h4>
          <form method="POST" action="/infrastructure/remove" onsubmit="return confirm('Are you sure you want to remove this infrastructure?');">
            <input type="hidden" name="user_id" value="${user_id}">
            <input type="hidden" name="infrastructure_id" value="${infra_id}">
            <button type="submit">Remove Infrastructure</button>
          </form>
          <br>
          <a href="/infrastructure?user_id=${user_id}">Back to Infrastructure List</a> |
          <a href="/home?user_id=${user_id}">Home</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send("Error loading infrastructure details.");
  }
});

app.post('/infrastructure/remove', requireUser, async (req, res) => {
  const { user_id, infrastructure_id } = req.body;
  try {
    await Infrastructure.deleteOne({ infrastructure_id, user_id });
    await User.findOneAndUpdate({ user_id }, { $pull: { linked_infrastructures: infrastructure_id } });
    await updateUserEcoIndex(user_id);
    res.redirect(`/infrastructure?user_id=${user_id}`);
  } catch(err) {
    console.error(err);
    res.send('Error removing infrastructure.');
  }
});

// -------------------------
// 11) Admin Routes (Middleware: Admin-only)
async function requireAdmin(req, res, next) {
  const user_id = req.query.user_id || req.body.user_id;
  if(!user_id) return res.send("Access denied: no user id provided.");
  const user = await User.findOne({ user_id });
  if(!user) return res.send("Access denied: user not found.");
  if(user.user_category !== "Admin") return res.send("Access denied: only admins can access this.");
  req.user = user;
  next();
}

// Admin Dashboard: List Infrastructure Status Filters and Bidding Status Filters
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const user_id = req.user.user_id;
  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Admin Dashboard</title></head>
      <body>
        <h1>Admin Dashboard</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <p>Select a status to view infrastructures:</p>
        <ul>
          <li><a href="/admin/status/Registered?user_id=${user_id}">Registered</a></li>
          <li><a href="/admin/status/Under%20Review?user_id=${user_id}">Under Review</a></li>
          <li><a href="/admin/status/Suspended?user_id=${user_id}">Suspended</a></li>
          <li><a href="/admin/status/Cleared?user_id=${user_id}">Cleared</a></li>
        </ul>
        <hr>
        <p>Select a status to view Bidding:</p>
        <ul>
          <li><a href="/admin/bidding/Submitted?user_id=${user_id}">Submitted</a></li>
          <li><a href="/admin/bidding/Accepted?user_id=${user_id}">Accepted</a></li>
          <li><a href="/admin/bidding/Partially%20Cleared?user_id=${user_id}">Partially Cleared</a></li>
          <li><a href="/admin/bidding/Rejected?user_id=${user_id}">Rejected</a></li>
          <li><a href="/admin/bidding/Canceled?user_id=${user_id}">Canceled</a></li>
          <li><a href="/admin/bidding/Producer%20Bid%20Retraction?user_id=${user_id}">Producer Bid Retraction</a></li>
          <li><a href="/admin/bidding/Compensatation?user_id=${user_id}">Compensatation</a></li>
        </ul>
        <br>
        <a href="/home?user_id=${user_id}">Back to Home</a>
      </body>
    </html>
  `);
});

// Admin view for Infrastructure by status
app.get('/admin/status/:stage', requireAdmin, async (req, res) => {
  const { stage } = req.params;
  const admin_id = req.user.user_id;
  try {
    const infrastructures = await Infrastructure.find({ "infrastructure_status.stage": stage });
    let html = `<h2>Infrastructures with status "${stage}"</h2>`;
    if(infrastructures.length === 0) {
      html += `<p>No infrastructures with this status.</p>`;
    } else {
      html += "<ul>";
      for(const infra of infrastructures) {
        let ownerDetails = "";
        if(infra.user_id) {
          const owner = await User.findOne({ user_id: infra.user_id });
          ownerDetails = owner ? `Owner: ${owner.user_id} (${owner.name}, ${owner.email_id || 'N/A'})` : `Owner: ${infra.user_id}`;
        }
        html += `
          <li>
            <strong>${infra.infrastructure_id}</strong> - Category: ${infra.infrastructure_category}, Type: ${infra.infrastructure_type}, Location: ${infra.location}, Eco Credit: ${infra.eco_index || "N/A"}
            ${infra.priority && infra.priority.priority_index ? ", Priority: " + infra.priority.priority_index : ""}
            <br>${ownerDetails}
            <a href="/admin/edit?infrastructure_id=${infra.infrastructure_id}&user_id=${admin_id}">Edit</a>
          </li>`;
      }
      html += "</ul>";
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Admin - ${stage}</title>
          <meta http-equiv="refresh" content="1">
        </head>
        <body>
          <h1>Admin View: ${stage}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          ${html}
          <br>
          <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send('Error retrieving infrastructures.');
  }
});

// Admin view for Bidding by status (from bid_updates in Bid docs)
app.get('/admin/bidding/:stage', requireAdmin, async (req, res) => {
  const { stage } = req.params;
  const admin_id = req.user.user_id;
  try {
    // Find bids that have at least one update with the matching stage
    const bids = await Bid.find({ "bid_updates.stage": stage });
    let html = `<h2>Bids with update stage "${stage}"</h2>`;
    if(bids.length === 0) {
      html += `<p>No bids with this update stage.</p>`;
    } else {
      html += "<ul>";
      for(const bid of bids) {
        html += `<li>
          <strong>${bid.bid_id}</strong> (Infrastructure: ${bid.infrastructure_id}) - Round: ${bid.bid_round}
          <br><a href="/admin/bid/edit?bid_id=${bid.bid_id}&user_id=${admin_id}">Edit Bid</a>
        </li>`;
      }
      html += "</ul>";
    }
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Admin - Bidding ${stage}</title>
          <meta http-equiv="refresh" content="1">
        </head>
        <body>
          <h1>Admin Bidding View: ${stage}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          ${html}
          <br>
          <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send('Error retrieving bids.');
  }
});

// Admin Edit Infrastructure
app.get('/admin/edit', requireAdmin, async (req, res) => {
  const { infrastructure_id } = req.query;
  const admin_id = req.user.user_id;
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id });
    if(!infra) return res.send("Infrastructure not found.");
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Edit Infrastructure</title></head>
        <body>
          <h1>Edit Infrastructure: ${infra.infrastructure_id}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          <form method="POST" action="/admin/edit">
            <input type="hidden" name="infrastructure_id" value="${infra.infrastructure_id}">
            <input type="hidden" name="admin_id" value="${admin_id}">
            <label>Status Stage:</label><br>
            <select name="status_stage" required>
              <option value="Registered" ${infra.infrastructure_status.stage==="Registered"?"selected":""}>Registered</option>
              <option value="Cleared" ${infra.infrastructure_status.stage==="Cleared"?"selected":""}>Cleared</option>
              <option value="Under Review" ${infra.infrastructure_status.stage==="Under Review"?"selected":""}>Under Review</option>
              <option value="Suspended" ${infra.infrastructure_status.stage==="Suspended"?"selected":""}>Suspended</option>
            </select><br><br>
            <label>Registration Status:</label><br>
            <select name="registration_status" required>
              <option value="Approved" ${infra.infrastructure_status.registration_status==="Approved"?"selected":""}>Approved</option>
              <option value="Rejected" ${infra.infrastructure_status.registration_status==="Rejected"?"selected":""}>Rejected</option>
              <option value="Pending" ${infra.infrastructure_status.registration_status==="Pending"?"selected":""}>Pending</option>
              <option value="Under Review" ${infra.infrastructure_status.registration_status==="Under Review"?"selected":""}>Under Review</option>
            </select><br><br>
            <label>Eco Credit (A-G):</label><br>
            <select name="eco_index" required>
              <option value="A" ${infra.eco_index==="A"?"selected":""}>A</option>
              <option value="B" ${infra.eco_index==="B"?"selected":""}>B</option>
              <option value="C" ${infra.eco_index==="C"?"selected":""}>C</option>
              <option value="D" ${infra.eco_index==="D"?"selected":""}>D</option>
              <option value="E" ${infra.eco_index==="E"?"selected":""}>E</option>
              <option value="F" ${infra.eco_index==="F"?"selected":""}>F</option>
              <option value="G" ${infra.eco_index==="G"?"selected":""}>G</option>
            </select><br><br>
            <label>Priority (1-100):</label><br>
            <input type="text" name="priority_index" value="${infra.priority && infra.priority.priority_index ? infra.priority.priority_index : ""}" required><br><br>
            <button type="submit">Update Infrastructure</button>
          </form>
          <br>
          <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send("Error loading edit page.");
  }
});

app.post('/admin/edit', requireAdmin, async (req, res) => {
  const { infrastructure_id, admin_id, status_stage, registration_status, eco_index, priority_index } = req.body;
  const now = new Date();
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id });
    if(!infra) return res.send("Infrastructure not found.");
    infra.infrastructure_status.stage = status_stage;
    infra.infrastructure_status.registration_status = registration_status;
    infra.infrastructure_status.status_history.push({
      timestamp: now,
      status: status_stage,
      updated_by: admin_id
    });
    infra.eco_index = eco_index;
    infra.priority = {
      priority_index,
      Timestamp: now,
      updated_by: admin_id
    };
    await infra.save();
    if(infra.user_id) {
      await updateUserEcoIndex(infra.user_id);
    }
    res.send(`Infrastructure ${infrastructure_id} updated successfully at ${getCurrentTime()}. <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>`);
  } catch(err) {
    console.error(err);
    res.send(`Error updating infrastructure at ${getCurrentTime()}. Please try again.`);
  }
});

// -------------------------
// (Optional) Admin Edit for Bid – similar approach can be applied
app.get('/admin/bid/edit', requireAdmin, async (req, res) => {
  const { bid_id } = req.query;
  const admin_id = req.user.user_id;
  try {
    const bid = await Bid.findOne({ bid_id });
    if(!bid) return res.send("Bid not found.");
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Edit Bid</title></head>
        <body>
          <h1>Edit Bid: ${bid.bid_id}</h1>
          <p>Current Time: ${getCurrentTime()}</p>
          <form method="POST" action="/admin/bid/edit">
            <input type="hidden" name="bid_id" value="${bid.bid_id}">
            <input type="hidden" name="admin_id" value="${admin_id}">
            <label>Bid Round:</label><br>
            <select name="bid_round" required>
              <option value="Day-Ahead" ${bid.bid_round==="Day-Ahead"?"selected":""}>Day-Ahead</option>
              <option value="15-Min" ${bid.bid_round==="15-Min"?"selected":""}>15-Min</option>
              <option value="Compensation" ${bid.bid_round==="Compensation"?"selected":""}>Compensation</option>
            </select><br><br>
            <label>Bid Price:</label><br>
            <input type="text" name="bid_price" value="${bid.bid_price}" required><br><br>
            <label>Bid Value:</label><br>
            <input type="text" name="bid_value" value="${bid.bid_value}" required><br><br>
            <button type="submit">Update Bid</button>
          </form>
          <br>
          <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>
        </body>
      </html>
    `);
  } catch(err) {
    console.error(err);
    res.send("Error loading bid edit page.");
  }
});

app.post('/admin/bid/edit', requireAdmin, async (req, res) => {
  const { bid_id, admin_id, bid_round, bid_price, bid_value } = req.body;
  try {
    const bid = await Bid.findOne({ bid_id });
    if(!bid) return res.send("Bid not found.");
    bid.bid_round = bid_round;
    bid.bid_price = bid_price;	
    bid.bid_value = bid_value;
    await bid.save();
    res.send(`Bid ${bid_id} updated successfully. <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>`);
  } catch(err) {
    console.error(err);
    res.send("Error updating bid.");
  }
});

// -------------------------
// 12) Init Sample Data (Run Once)
// WARNING: This route is not secured – remove or secure it in production.
app.get('/initdb', async (req, res) => {
  try {
    // Insert sample User Profile (Admin)
    const sampleUser = new User({
      user_id: "U1234",
      name: "John Doe",
      user_category: "Admin",
      user_type: "",
      location: "",
      created_on: new Date("2025-03-29T15:30:00Z"),
      eco_index: "B",
      linked_infrastructures: ["INF1001", "INF1002"]
    });
    // Insert corresponding User Authentication
    const { hash, salt, iterations } = hashPassword("password123");
    const sampleUserAuth = new UserAuth({
      user_id: "U1234",
      password: {
        current_hash: hash,
        salt: salt,
        iterations: iterations,
        updates: [],
        last_updated: new Date("2025-03-29T15:30:00Z")
      }
    });
    await sampleUser.save();
    await sampleUserAuth.save();

    // Sample Infrastructure Registration
    const sampleInfra = new Infrastructure({
      infrastructure_id: "INF1001",
      user_id: "U1234",
      infrastructure_category: "Producer",
      infrastructure_type: "Industrial",
      location: "Hyderabad, India",
      load_demand: {
        value: 5000,
        updated_on: new Date("2025-03-30T08:00:00Z"),
        stage: "Registered",
        registration_status: "Approved",
        status_history: [
          { timestamp: new Date("2025-03-29T10:00:00Z"), status: "Submitted", updated_by: "Admin1" },
          { timestamp: new Date("2025-03-29T12:00:00Z"), status: "Approved", updated_by: "Admin2" }
        ]
      },
      eco_index: "C",
      region: "Southern",
      infrastructure_status: {
        stage: "Registered",
        registration_status: "Approved",
        status_history: [
          { timestamp: new Date("2025-03-29T10:00:00Z"), status: "Submitted", updated_by: "Admin1" },
          { timestamp: new Date("2025-03-29T12:00:00Z"), status: "Approved", updated_by: "Admin2" }
        ]
      },
      priority: {
        priority_index: "3",
        Timestamp: new Date("2025-03-29T12:00:00Z"),
        updated_by: "Admin2"
      }
    });
    await sampleInfra.save();

    // Sample Real-Time Infrastructure Data
    const sampleRTData = new RealTimeInfra({
      infrastructure_id: "INF1001",
      real_time_data: [{
        status: "Active",
        data_timestamp: new Date("2025-03-30T10:15:00Z"),
        voltage: 230.5,
        current: -12.3
      }]
    });
    await sampleRTData.save();

    // Sample Bidding Documents
    const sampleBid1 = new Bid({
      bid_id: "BID5678",
      infrastructure_id: "INF1001",
      bid_round: "Day-Ahead",
      bid_price: [50, 52, 51, 53, 55, 54, 52, 50, 51, 53, 55, 54],
      bid_value: [100, 110, 120, 130, 140, 150, 140, 130, 120, 110, 100, 90],
      bid_submitted_timestamp: new Date("2025-03-30T00:00:00Z"),
      bid_updates: [
        { stage: "Submitted", status: "Pending", timestamp: new Date("2025-03-30T00:05:00Z"), Allocated: [0,0,0,0,0,0,0,0,0,0,0,0], Price: [] },
        { stage: "Partially Cleared", status: "Approved", timestamp: new Date("2025-03-30T00:05:00Z"), Allocated: [45,5,50,31,5,54,52,5,0,83,55,23], Price: [50,52,50,53,55,54,52,50,83,55,54] },
        { stage: "Accepted", status: "Approved", timestamp: new Date("2025-03-30T00:15:00Z"), Allocated: [50,52,50,53,55,54,52,50,51,83,55,54], Price: [50,52,50,53,55,54,52,50,51,83,55,54] }
      ]
    });
    const sampleBid2 = new Bid({
      bid_id: "BID5679",
      infrastructure_id: "INF1001",
      bid_round: "15-Min",
      bid_price: 50,
      bid_value: 120,
      bid_submitted_timestamp: new Date("2025-03-31T00:00:00Z"),
      bid_updates: [
        { stage: "Submitted", timestamp: new Date("2025-03-31T00:25:00Z"), Allocated: 0, Price: "" },
        { stage: "Accepted", timestamp: new Date("2025-03-31T00:30:00Z"), Allocated: 120, Price: "55" }
      ]
    });
    await sampleBid1.save();
    await sampleBid2.save();

    // Sample Billing Document
    const sampleBilling = new Billing({
      billing_id: "BILL7890",
      infrastructure_id: "INF1001",
      billed_day: "2025-03-30",
      daily_billing_updates: [
        { bid_id: "BID5678", billing_round: "Day-Ahead", billing_amount: [50,52,50,53,55,54,52,50,51,83,55,54], billed_at: new Date("2025-03-30T23:59:00Z") },
        { bid_id: "BID5679", billing_round: "15-Min", billing_amount: "55", billed_at: new Date("2025-03-30T23:59:00Z") }
      ],
      Credit: "9"
    });
    await sampleBilling.save();

    // Sample Wallet & Transactions
    const sampleWallet = new Wallet({
      user_id: "U1234",
      wallet: {
        balance: 15000,
        transactions: [
          { transaction_id: "TXN001", transaction_category: "Credit", transaction_status: "Completed", transaction_amount: 5000, updated_wallet_amount: 15000, timestamp: new Date("2025-03-30T11:00:00Z") },
          { transaction_id: "TXN002", transaction_category: "Debit", transaction_status: "Completed", transaction_amount: 2000, updated_wallet_amount: 13000, timestamp: new Date("2025-03-30T12:00:00Z") }
        ]
      }
    });
    await sampleWallet.save();

    // Sample Market Performance Report
    const sampleReport = new MarketReport({
      report_id: "REP1001",
      report_date: "2025-03-30",
      market_type: "Day-Ahead",
      average_clearing_price: 52.5,
      total_energy_traded_MWh: 15000,
      losses_percent: 6.5,
      notes: "Slight increase in clearing price due to unexpected renewable variability."
    });
    await sampleReport.save();

    // Sample Notification
    const sampleNotification = new Notification({
      notification_id: "NOTIF2001",
      user_id: "U1234",
      infrastructure_id: "INF1001",
      notification_type: "Bid Update",
      message: "Your bid BID5678 has been accepted in the Day-Ahead round.",
      created_on: new Date("2025-03-30T00:20:00Z"),
      read: false
    });
    await sampleNotification.save();

    // Sample Audit Log
    const sampleAuditLog = new AuditLog({
      log_id: "LOG3001",
      entity_type: "Bid",
      entity_id: "BID5678",
      action: "Status Updated",
      details: "Bid stage updated from Submitted to Accepted by Admin2.",
      timestamp: new Date("2025-03-30T00:15:00Z"),
      performed_by: "Admin2",
      IPv4_Address: "202.88.252.190",
      IPv6_Address: "Not detected",
      IP_Location: "Thiruvananthapuram, Kerala (IN)",
      Host_Name: "190.252.88.202.asianet.co.in",
      Proxy: "No proxy present",
      Device_Type: "PC",
      OS: "Windows 10",
      Browser: "Chrome",
      User_Agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
      Screen_Size: "1366px X 768px"
    });
    await sampleAuditLog.save();

    res.send("Sample data inserted successfully.");
  } catch(err) {
    console.error(err);
    res.send("Error inserting sample data.");
  }
});

// -------------------------
// 13) Start the Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
