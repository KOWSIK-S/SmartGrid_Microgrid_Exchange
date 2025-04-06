/*********************************************
 * app.js - Complete Application with User,  *
 * Admin, Infrastructure, Linking, Bidding,  *
 * and 20-sec Auto-Refresh on View Page       *
 *********************************************/
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
const port = 3000;

// ---------------------------------------------
// 1) Connect to MongoDB (database "mydb")
// ---------------------------------------------
mongoose.connect('mongodb://localhost:27017/mydb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB successfully.");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// ---------------------------------------------
// 2) Define Schemas & Models
// ---------------------------------------------
// --- User Schema ---
const userSchema = new mongoose.Schema({
  user_id: { type: String, unique: true },
  name: String,
  email_id: String,
  user_category: String,   // "Admin" or "User"
  user_type: String,       // empty for admins
  location: String,        // empty for admins
  created_on: Date,
  eco_index: { type: String, enum: ["A","B","C","D","E","F","G"] },
  linked_infrastructures: { type: [String], default: [] },
  password: {
    current_hash: String,
    updates: [{
      hash: String,
      updated_at: Date
    }],
    last_updated: Date
  }
});
const User = mongoose.model('User', userSchema);

// --- Infrastructure Schema ---
const infrastructureSchema = new mongoose.Schema({
  infrastructure_id: { type: String, unique: true },
  user_id: String,
  infrastructure_category: { 
    type: String, 
    enum: ["Producer", "Consumer", "AncillaryStabilizers"] 
  },
  infrastructure_type: { 
    type: String, 
    enum: ["Residential", "Industrial", "NGO", "Govt", "Public"] 
  },
  location: String,
  load_demand: {
    value: Number,
    updated_on: Date,
    stage: { 
      type: String, 
      enum: ["Registered", "Cleared", "Under Review", "Suspended"], 
      default: "Registered" 
    },
    registration_status: { 
      type: String, 
      enum: ["Approved", "Rejected", "Pending", "Under Review"], 
      default: "Pending" 
    },
    status_history: [{
      timestamp: Date,
      status: { 
        type: String, 
        enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction"] 
      },
      updated_by: String
    }]
  },
  eco_index: { type: String, enum: ["A", "B", "C", "D", "E", "F", "G"] },
  region: { type: String, enum: ["Central", "Southern", "Eastern", "High Province"] },
  infrastructure_status: {
    stage: { 
      type: String, 
      enum: ["Registered", "Cleared", "Under Review", "Suspended", "Updated"], 
      default: "Registered" 
    },
    registration_status: { 
      type: String, 
      enum: ["Approved", "Rejected", "Pending", "Under Review"], 
      default: "Pending" 
    },
    status_history: [{
      timestamp: Date,
      status: { 
        type: String, 
        enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction"] 
      },
      updated_by: String
    }]
  },
  priority: {
    priority_index: String,  
    Timestamp: Date,
    updated_by: String
  }
});
const Infrastructure = mongoose.model('Infrastructure', infrastructureSchema);

// --- Real-Time Infrastructure Data Schema ---
const realTimeInfraSchema = new mongoose.Schema({
  infrastructure_id: { type: String, unique: true },
  real_time_data: [{
    status: {
      type: String,
      enum: ["Active", "Qualified-Inactive", "Suspended", "Under Review", "Access", "Offline"]
    },
    data_timestamp: Date,
    voltage: Number,
    current: Number
  }]
});
const RealTimeInfra = mongoose.model('RealTimeInfra', realTimeInfraSchema);

// --- Bidding Schema ---
const biddingSchema = new mongoose.Schema({
  bid_id: { type: String, unique: true },
  infrastructure_id: String,
  bid_round: { type: String, enum: ["Day-Ahead", "15-Min", "Compensation"] },
  bid_price: mongoose.Schema.Types.Mixed, // can be number or array
  bid_value: mongoose.Schema.Types.Mixed,
  bid_submitted_timestamp: Date,
  bid_updates: [{
    stage: { 
      type: String, 
      enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction", "Compensatation"] 
    },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"] },
    timestamp: Date,
    Allocated: mongoose.Schema.Types.Mixed,
    Price: mongoose.Schema.Types.Mixed
  }]
});
const Bidding = mongoose.model("Bidding", biddingSchema);

// ---------------------------------------------
// 3) Utility Functions
// ---------------------------------------------
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
  return new Date().toLocaleString();
}

// ---------------------------------------------
// 4) Express & Body-Parser Setup
// ---------------------------------------------
app.use(bodyParser.urlencoded({ extended: true }));

// ---------------------------------------------
// 5) Website Routes (Landing, Signup, Signin, etc.)
// ---------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Welcome</title>
      </head>
      <body>
        <h1>Welcome!</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <p>Choose an option:</p>
        <ul>
          <li><a href="/signup">Sign Up</a></li>
          <li><a href="/signin">Sign In</a></li>
          <li><a href="/forgot">Forgot Password</a></li>
        </ul>
        <p>For Bid Data, try: <a href="/bid?infrastructure_id=INF1001">/bid?infrastructure_id=INF1001</a></p>
      </body>
    </html>
  `);
});

// --- Sign Up ---
app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sign Up</title>
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
          window.onload = checkCategory;
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
          <label>Password:</label><br>
          <input type="password" name="password" required><br><br>
          <label>Confirm Password:</label><br>
          <input type="password" name="confirm_password" required><br><br>
          <button type="submit">Sign Up</button>
        </form>
        <br><a href="/">Back to Home</a>
      </body>
    </html>
  `);
});

app.post('/signup', async (req, res) => {
  const { name, email_id, user_category, user_type, location, password, confirm_password } = req.body;
  if (password !== confirm_password) return res.send('Passwords do not match.');
  const user_id = "U" + crypto.randomBytes(3).toString('hex').toUpperCase();
  const created_on = new Date();
  const current_hash = crypto.createHash('sha256').update(password).digest('hex');
  let finalUserType = user_category === "Admin" ? "" : user_type;
  let finalLocation = user_category === "Admin" ? "" : location;
  const newUser = new User({
    user_id,
    name,
    email_id,
    user_category,
    user_type: finalUserType,
    location: finalLocation,
    created_on,
    password: {
      current_hash,
      updates: [],
      last_updated: created_on
    }
  });
  if (user_category === "Admin") {
    newUser.eco_index = undefined;
  } else {
    newUser.eco_index = "B";
  }
  try {
    await newUser.save();
    res.redirect(`/home?user_id=${user_id}`);
  } catch (err) {
    console.error(err);
    res.send('Error during signup.');
  }
});

// --- Sign In ---
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
    const user = await User.findOne({ user_id });
    if (!user) return res.send('User not found.');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (passwordHash !== user.password.current_hash) return res.send('Incorrect password.');
    res.redirect(`/home?user_id=${user_id}`);
  } catch (err) {
    console.error(err);
    res.send('Error during sign in.');
  }
});

// --- Forgot Password ---
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
  if (new_password !== confirm_new_password) return res.send('Passwords do not match.');
  try {
    const user = await User.findOne({ user_id });
    if (!user) return res.send('User not found.');
    const newHash = crypto.createHash('sha256').update(new_password).digest('hex');
    user.password.updates.push({ hash: user.password.current_hash, updated_at: new Date() });
    user.password.current_hash = newHash;
    user.password.last_updated = new Date();
    await user.save();
    res.send('Password updated. <a href="/signin">Sign In</a>');
  } catch (err) {
    console.error(err);
    res.send('Error updating password.');
  }
});

// --- Home Page ---
app.get('/home', async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.send("No user ID provided.");
  try {
    const user = await User.findOne({ user_id });
    if (!user) return res.send("User not found.");
    let ecoIndexHTML = "";
    if (user.user_category !== "Admin" && user.eco_index) {
      ecoIndexHTML = `<p><strong>Eco Index:</strong> ${user.eco_index}</p>`;
    }
    let linkHTML = "";
    if (user.user_category === "User") {
      linkHTML = `<a href="/infrastructure?user_id=${user_id}">Manage Infrastructures</a> | `;
    } else if (user.user_category === "Admin") {
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
          <p><strong>Email ID:</strong> ${user.email_id}</p>
          <p><strong>User Category:</strong> ${user.user_category}</p>
          ${user.user_category !== "Admin" ? `<p><strong>User Type:</strong> ${user.user_type}</p>
          <p><strong>Location:</strong> ${user.location}</p>` : ""}
          <p><strong>Created On:</strong> ${user.created_on.toISOString()}</p>
          ${ecoIndexHTML}
          <br>
          ${linkHTML}
          <a href="/signin">Sign Out</a>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error retrieving home page.");
  }
});

// ---------------------------------------------
// 6) Infrastructure & Linking Routes (User Only)
// ---------------------------------------------
async function requireUser(req, res, next) {
  const user_id = req.query.user_id || req.body.user_id;
  if (!user_id) return res.send("Access denied: no user id provided.");
  const user = await User.findOne({ user_id });
  if (!user) return res.send("User not found.");
  if (user.user_category !== "User") return res.send("Access denied: Only non-admin users can do this.");
  req.user = user;
  next();
}

// Main infrastructure management page.
app.get('/infrastructure', requireUser, async (req, res) => {
  const user_id = req.user.user_id;
  const infrastructures = await Infrastructure.find({ user_id });
  let infraListHtml = "<h2>Your Infrastructures</h2>";
  if (infrastructures.length === 0) {
    infraListHtml += "<p>No infrastructures registered yet.</p>";
  } else {
    infraListHtml += "<ul>";
    for (const infra of infrastructures) {
      let realTimeDoc = await RealTimeInfra.findOne({ infrastructure_id: infra.infrastructure_id });
      let rtStatus = "No data", rtVoltage = "NaN", rtCurrent = "NaN";
      if (realTimeDoc && realTimeDoc.real_time_data && realTimeDoc.real_time_data.length > 0) {
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
        <meta http-equiv="refresh" content="20">
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
            <option value="B">B</option>
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
        <br>
        <a href="/infrastructure/link?user_id=${user_id}">
          <button>Link Existing Infrastructure</button>
        </a>
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
  } catch (err) {
    console.error(err);
    res.send('Error adding infrastructure.');
  }
});

// Route to view detailed infrastructure info.
app.get('/infrastructure/view', requireUser, async (req, res) => {
  const user_id = req.query.user_id;
  const infra_id = req.query.infrastructure_id;
  if (!infra_id) return res.send("No infrastructure_id provided.");
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id: infra_id, user_id });
    if (!infra) return res.send("Infrastructure not found for this user.");
    
    let realTimeDoc = await RealTimeInfra.findOne({ infrastructure_id: infra_id });
    let rtStatus = "No data", rtVoltage = "NaN", rtCurrent = "NaN", rtTimestamp = "N/A";
    if (realTimeDoc && realTimeDoc.real_time_data && realTimeDoc.real_time_data.length > 0) {
      realTimeDoc.real_time_data.sort((a, b) => b.data_timestamp - a.data_timestamp);
      const latest = realTimeDoc.real_time_data[0];
      const diffMs = new Date() - latest.data_timestamp;
      const diffMin = diffMs / 60000;
      rtStatus = diffMin > 1 ? "Offline" : latest.status;
      rtVoltage = latest.voltage;
      rtCurrent = latest.current;
      rtTimestamp = latest.data_timestamp.toISOString();
    }
    // Build a link to the bidding details for this infrastructure.
    const biddingLink = `/bid?infrastructure_id=${infra_id}`;
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Infrastructure Details</title>
          <meta http-equiv="refresh" content="20">
        </head>
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
          <!-- Link to view bidding details -->
          <a href="${biddingLink}">
            <button>View Bidding Details</button>
          </a>
          <br><br>
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
  } catch (err) {
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
  } catch (err) {
    console.error(err);
    res.send('Error removing infrastructure.');
  }
});

// New routes for linking an existing infrastructure.
app.get('/infrastructure/link', requireUser, (req, res) => {
  const user_id = req.query.user_id;
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Link Infrastructure</title>
      </head>
      <body>
        <h1>Link Existing Infrastructure</h1>
        <p>Current Time: ${getCurrentTime()}</p>
        <form method="POST" action="/infrastructure/link">
          <input type="hidden" name="user_id" value="${user_id}">
          <label>Enter Infrastructure ID to Link:</label><br>
          <input type="text" name="infrastructure_id" required><br><br>
          <button type="submit">Link Infrastructure</button>
        </form>
        <br>
        <a href="/infrastructure?user_id=${user_id}">Back to Infrastructure List</a>
      </body>
    </html>
  `);
});

app.post('/infrastructure/link', requireUser, async (req, res) => {
  const { user_id, infrastructure_id } = req.body;
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id });
    if (!infra) return res.send(`Infrastructure ID ${infrastructure_id} not found. <a href="/infrastructure/link?user_id=${user_id}">Try again</a>`);
    const user = req.user;
    if (!user.linked_infrastructures.includes(infrastructure_id)) {
      user.linked_infrastructures.push(infrastructure_id);
      await user.save();
    }
    res.redirect(`/infrastructure?user_id=${user_id}`);
  } catch (err) {
    console.error(err);
    res.send('Error linking infrastructure.');
  }
});

// ---------------------------------------------
// 7) Admin Routes (User must be Admin)
// ---------------------------------------------
async function requireAdmin(req, res, next) {
  const user_id = req.query.user_id || req.body.user_id;
  if (!user_id) return res.send("Access denied: no user id provided.");
  const user = await User.findOne({ user_id });
  if (!user) return res.send("Access denied: user not found.");
  if (user.user_category !== "Admin") return res.send("Access denied: only admins can access this.");
  req.user = user;
  next();
}

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
        <br>
        <a href="/home?user_id=${user_id}">Back to Home</a>
      </body>
    </html>
  `);
});

app.get('/admin/status/:stage', requireAdmin, async (req, res) => {
  const { stage } = req.params;
  const admin_id = req.user.user_id;
  try {
    const infrastructures = await Infrastructure.find({ "infrastructure_status.stage": stage });
    let html = `<h2>Infrastructures with status "${stage}"</h2>`;
    if (infrastructures.length === 0) {
      html += `<p>No infrastructures with this status.</p>`;
    } else {
      html += "<ul>";
      for (const infra of infrastructures) {
        let ownerDetails = "";
        if (infra.user_id) {
          const owner = await User.findOne({ user_id: infra.user_id });
          if (owner) {
            ownerDetails = `Owner: ${owner.user_id} (${owner.name}, ${owner.email_id})`;
          } else {
            ownerDetails = `Owner: ${infra.user_id}`;
          }
        }
        html += `
          <li>
            <strong>${infra.infrastructure_id}</strong> - 
            Category: ${infra.infrastructure_category}, Type: ${infra.infrastructure_type}, 
            Location: ${infra.location}, Eco Credit: ${infra.eco_index || "N/A"}
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
          <meta http-equiv="refresh" content="20">
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
  } catch (err) {
    console.error(err);
    res.send('Error retrieving infrastructures.');
  }
});

app.get('/admin/edit', requireAdmin, async (req, res) => {
  const { infrastructure_id } = req.query;
  const admin_id = req.user.user_id;
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id });
    if (!infra) return res.send("Infrastructure not found.");
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
  } catch (err) {
    console.error(err);
    res.send("Error loading edit page.");
  }
});

app.post('/admin/edit', requireAdmin, async (req, res) => {
  const { infrastructure_id, admin_id, status_stage, registration_status, eco_index, priority_index } = req.body;
  const now = new Date();
  try {
    const infra = await Infrastructure.findOne({ infrastructure_id });
    if (!infra) return res.send("Infrastructure not found.");
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
    if (infra.user_id) {
      await updateUserEcoIndex(infra.user_id);
    }
    res.send(`Infrastructure ${infrastructure_id} updated successfully at ${getCurrentTime()}. <a href="/admin/dashboard?user_id=${admin_id}">Back to Dashboard</a>`);
  } catch (err) {
    console.error(err);
    res.send(`Error updating infrastructure at ${getCurrentTime()}. Please try again.`);
  }
});

// ---------------------------------------------
// 8) Bidding API Route
// ---------------------------------------------
app.get('/bid', async (req, res) => {
  const { infrastructure_id } = req.query;
  if (!infrastructure_id) {
    return res.status(400).json({ error: "Query parameter 'infrastructure_id' is required" });
  }
  try {
    const bids = await Bidding.find({ infrastructure_id }).lean();
    if (bids.length === 0) {
      return res.status(404).json({ message: 'No bids found for this infrastructure ID.' });
    }
    res.json(bids);
  } catch (error) {
    console.error('Error fetching bids:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------
// 9) Start the Server
// ---------------------------------------------
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
