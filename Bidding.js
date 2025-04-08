/*********************************************
 * bidding-app.js - Calendar-based Bidding Application
 *
 * This application:
 *  - Connects to MongoDB and uses a Bid schema matching the provided examples:
 *    - Day-Ahead bid: arrays for bid_price, bid_value, and bid_updates fields (12 elements).
 *    - 15-Min bid: scalar values for bid_price, bid_value, and bid_updates fields.
 *  - Displays an interactive drill-down calendar (year > month > day > 6hr > hr > 15min).
 *  - Provides a bid submission form at each level:
 *    - Accepts single bid_price and bid_value inputs.
 *    - For Day-Ahead (day, 6hr, hr), replicates inputs into arrays (12, 6, 1 elements).
 *    - For 15-Min, keeps inputs as scalars and shows corresponding Day-Ahead values (read-only).
 *    - Uses defaults (NaN for bid_price, 0 for bid_value) if inputs are invalid/empty.
 *  - Enforces editing windows:
 *    - Day-Ahead: editable 2pm-5pm the day before.
 *    - 15-Min: editable 25-15 minutes before the slot.
 *  - Displays previous bid values when not editable.
 *  - Auto-refreshes the bid submission form every second.
 *  - Generates unique bid IDs upon submission and tracks bid history via bid_updates.
 *********************************************/

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();
const port = 3000;

// --- 1. MongoDB Connection ---
mongoose.connect('mongodb://localhost:27017/biddingdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB.");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// --- 2. Bid Schema & Model ---
const bidSchema = new mongoose.Schema({
  bid_id: { type: String, required: true, unique: true },
  infrastructure_id: { type: String, required: true },
  bid_round: { 
    type: String, 
    enum: ["Day-Ahead", "15-Min", "Compensation"], 
    required: true 
  },
  bid_price: { type: mongoose.Schema.Types.Mixed, default: null }, // Array for Day-Ahead, number for 15-Min
  bid_value: { type: mongoose.Schema.Types.Mixed, default: null }, // Array for Day-Ahead, number for 15-Min
  bid_submitted_timestamp: { type: Date, default: Date.now },
  last_updated: { type: Date, default: Date.now },
  bid_updates: [{
    stage: { 
      type: String, 
      enum: ["Submitted", "Accepted", "Partially Cleared", "Rejected", "Canceled", "Producer Bid Retraction", "Compensation"],
      default: "Submitted" 
    },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
    timestamp: { type: Date, default: Date.now },
    Allocated: { type: mongoose.Schema.Types.Mixed, default: null }, // Array for Day-Ahead, number for 15-Min
    Price: { type: mongoose.Schema.Types.Mixed, default: null }     // Array for Day-Ahead, string for 15-Min
  }]
});
const Bid = mongoose.model('Bid', bidSchema);

// --- 3. Express Setup ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // For serving static files like CSS if needed

// --- 4. Utility Functions ---

/** Replicate a value into an array based on level, or keep as scalar for 15-Min */
function replicateBid(level, input, defaultValue) {
  let value = input && !isNaN(parseFloat(input)) ? parseFloat(input) : defaultValue;
  const lengths = { 'day': 12, '6hr': 6, 'hr': 1, '15min': null };
  const len = lengths[level];
  return len ? Array(len).fill(value) : value;
}

/** Get the start time of the period based on level */
function getPeriodStart(level, time) {
  const date = new Date(time);
  if (level === 'day') {
    date.setUTCHours(0, 0, 0, 0);
  } else if (level === '6hr') {
    const hour = Math.floor(date.getUTCHours() / 6) * 6;
    date.setUTCHours(hour, 0, 0, 0);
  } else if (level === 'hr') {
    date.setUTCMinutes(0, 0, 0);
  } else if (level === '15min') {
    const minute = Math.floor(date.getUTCMinutes() / 15) * 15;
    date.setUTCMinutes(minute, 0, 0);
  }
  return date;
}

/** Check if the current time is within the editing window */
function isEditable(level, selectedTime) {
  const now = new Date();
  const selected = new Date(selectedTime);
  if (level === 'day' || level === '6hr' || level === 'hr') {
    const dayBefore = new Date(selected);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const startEdit = new Date(dayBefore.setUTCHours(14, 0, 0, 0));
    const endEdit = new Date(dayBefore.setUTCHours(17, 0, 0, 0));
    return now >= startEdit && now < endEdit;
  } else if (level === '15min') {
    const startEdit = new Date(selected.getTime() - 25 * 60 * 1000);
    const endEdit = new Date(selected.getTime() - 15 * 60 * 1000);
    return now >= startEdit && now < endEdit;
  }
  return false;
}

/** Fetch the most recent bid for a given slot */
async function fetchLatestBid(infraID, bidRound, selectedTime, level) {
  const query = {
    infrastructure_id: infraID,
    bid_round: bidRound,
    bid_submitted_timestamp: selectedTime
  };
  if (bidRound === 'Day-Ahead') {
    const lengths = { 'day': 12, '6hr': 6, 'hr': 1 };
    query['$expr'] = { $eq: [{ $size: "$bid_price" }, lengths[level]] };
  } else {
    query['bid_price'] = { $type: "number" };
  }
  return await Bid.findOne(query).sort({ last_updated: -1 });
}

/** Fetch Day-Ahead allocated values for a 15-Min slot */
async function fetchDayAheadValues(infraID, selectedTime) {
  const selected = new Date(selectedTime);
  const dayStart = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate(), 0, 0, 0));
  const dayAheadBid = await Bid.findOne({
    infrastructure_id: infraID,
    bid_round: "Day-Ahead",
    bid_submitted_timestamp: dayStart,
    '$expr': { $eq: [{ $size: "$bid_price" }, 12] }
  }).sort({ last_updated: -1 });
  if (dayAheadBid) {
    const latestUpdate = dayAheadBid.bid_updates.find(u => u.stage === "Accepted" || u.stage === "Partially Cleared");
    if (latestUpdate) {
      const hourIndex = selected.getUTCHours();
      return {
        allocated: latestUpdate.Allocated[hourIndex],
        price: latestUpdate.Price[hourIndex]
      };
    }
  }
  return { allocated: 0, price: "" };
}

// --- 5. Calendar Route (/bid) ---
app.get('/bid', (req, res) => {
  const infraID = req.query.infrastructure_id || "INF1001";
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Bidding Calendar</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f9; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .nav { display: flex; justify-content: space-between; margin-bottom: 20px; }
        button { padding: 10px 20px; background: #6200ea; color: #fff; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #3700b3; }
        #calendar { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
        .item { padding: 15px; background: #e8eaf6; border-radius: 5px; text-align: center; cursor: pointer; }
        .item:hover { background: #c5cae9; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; }
        .modal-content { background: #fff; padding: 20px; border-radius: 8px; text-align: center; }
        .modal button { margin: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="nav">
          <button id="back">Back</button>
          <h2 id="title"></h2>
          <div>
            <button id="prev">Prev</button>
            <button id="next">Next</button>
          </div>
        </div>
        <div id="calendar"></div>
      </div>
      <div id="modal" class="modal">
        <div class="modal-content">
          <p id="modal-text"></p>
          <button id="bid-btn">Bid</button>
          <button id="down-btn">Down</button>
        </div>
      </div>
      <script>
        const infraID = "${infraID}";
        let state = {
          view: 'month',
          year: new Date().getUTCFullYear(),
          month: new Date().getUTCMonth(),
          day: new Date().getUTCDate(),
          block: 0,
          hour: 0,
          minute: 0
        };

        const calendar = document.getElementById('calendar');
        const title = document.getElementById('title');
        const back = document.getElementById('back');
        const prev = document.getElementById('prev');
        const next = document.getElementById('next');
        const modal = document.getElementById('modal');
        const modalText = document.getElementById('modal-text');
        const bidBtn = document.getElementById('bid-btn');
        const downBtn = document.getElementById('down-btn');

        function render() {
          calendar.innerHTML = '';
          title.textContent = '';
          let items = [];
          if (state.view === 'year') {
            title.textContent = state.year;
            items = Array.from({ length: 12 }, (_, i) => new Date(state.year, i).toLocaleString('default', { month: 'long' }));
          } else if (state.view === 'month') {
            title.textContent = new Date(state.year, state.month).toLocaleString('default', { month: 'long', year: 'numeric' });
            const days = new Date(state.year, state.month + 1, 0).getUTCDate();
            items = Array.from({ length: days }, (_, i) => i + 1);
          } else if (state.view === 'day') {
            title.textContent = new Date(state.year, state.month, state.day).toUTCString().split(' ')[1] + ' ' + state.day;
            items = [0, 6, 12, 18].map(h => h + ':00');
          } else if (state.view === '6hr') {
            title.textContent = state.day + ' ' + state.block + ':00';
            items = Array.from({ length: 6 }, (_, i) => state.block + i + ':00');
          } else if (state.view === 'hr') {
            title.textContent = state.day + ' ' + state.hour + ':00';
            items = [0, 15, 30, 45].map(m => state.hour + ':' + (m < 10 ? '0' + m : m));
          } else if (state.view === '15min') {
            title.textContent = state.day + ' ' + state.hour + ':' + (state.minute < 10 ? '0' + state.minute : state.minute);
            items = ['Bid Now'];
          }
          items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'item';
            div.textContent = item;
            div.onclick = () => showModal(item);
            calendar.appendChild(div);
          });
          downBtn.style.display = state.view !== '15min' ? 'inline' : 'none';
        }

        function showModal(item) {
          modal.style.display = 'flex';
          modalText.textContent = 'Action for ' + item + '?';
          const date = new Date(Date.UTC(state.year, state.month, state.day, state.hour, state.minute));
          if (state.view === 'year') {
            state.month = new Date(state.year, item).getMonth();
          } else if (state.view === 'month') {
            state.day = parseInt(item);
          } else if (state.view === 'day') {
            state.block = parseInt(item.split(':')[0]);
          } else if (state.view === '6hr') {
            state.hour = state.block + parseInt(item.split(':')[0]);
          } else if (state.view === 'hr') {
            state.minute = parseInt(item.split(':')[1]);
          }
          date.setUTCFullYear(state.year);
          date.setUTCMonth(state.month);
          date.setUTCDate(state.day);
          date.setUTCHours(state.hour, state.minute, 0, 0);
          bidBtn.onclick = () => {
            const level = { year: 'day', month: 'day', day: '6hr', '6hr': 'hr', hr: '15min', '15min': '15min' }[state.view];
            window.location.href = '/bid/submit?level=' + level + '&date=' + date.toISOString() + '&infrastructure_id=' + infraID;
          };
          downBtn.onclick = () => {
            state.view = { year: 'month', month: 'day', day: '6hr', '6hr': 'hr', hr: '15min' }[state.view];
            render();
            modal.style.display = 'none';
          };
        }

        back.onclick = () => {
          state.view = { month: 'year', day: 'month', '6hr': 'day', hr: '6hr', '15min': 'hr' }[state.view] || 'year';
          render();
        };
        prev.onclick = () => {
          if (state.view === 'year') state.year--;
          else if (state.view === 'month') state.month = (state.month - 1 + 12) % 12;
          else if (state.view === 'day') state.day--;
          else if (state.view === '6hr') state.block = Math.max(0, state.block - 6);
          else if (state.view === 'hr') state.hour--;
          else if (state.view === '15min') state.minute = Math.max(0, state.minute - 15);
          render();
        };
        next.onclick = () => {
          if (state.view === 'year') state.year++;
          else if (state.view === 'month') state.month = (state.month + 1) % 12;
          else if (state.view === 'day') state.day++;
          else if (state.view === '6hr') state.block = Math.min(18, state.block + 6);
          else if (state.view === 'hr') state.hour++;
          else if (state.view === '15min') state.minute = Math.min(45, state.minute + 15);
          render();
        };
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        render();

        setInterval(() => {
          if (state.view === '15min') render();
        }, 1000);
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// --- 6. Bid Submission Form Route (/bid/submit) ---
app.get('/bid/submit', async (req, res) => {
  const level = req.query.level || 'hr';
  const selectedTime = getPeriodStart(level, req.query.date || new Date().toISOString());
  const infraID = req.query.infrastructure_id || "INF1001";
  const bidRound = level === '15min' ? '15-Min' : 'Day-Ahead';

  const editable = isEditable(level, selectedTime);
  const latestBid = await fetchLatestBid(infraID, bidRound, selectedTime, level);
  let bidPrice = editable ? '' : (latestBid ? (Array.isArray(latestBid.bid_price) ? latestBid.bid_price[0] : latestBid.bid_price) : NaN);
  let bidValue = editable ? '' : (latestBid ? (Array.isArray(latestBid.bid_value) ? latestBid.bid_value[0] : latestBid.bid_value) : 0);

  let dayAheadValues = { allocated: '', price: '' };
  if (level === '15min') {
    dayAheadValues = await fetchDayAheadValues(infraID, selectedTime);
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="1">
      <title>Submit Bid</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f9; padding: 20px; }
        .form-container { max-width: 500px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        label { display: block; margin: 10px 0 5px; }
        input, select { width: 100%; padding: 8px; margin-bottom: 10px; border-radius: 4px; border: 1px solid #ccc; }
        input[readonly] { background: #e0e0e0; }
        button { padding: 10px 20px; background: #6200ea; color: #fff; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #3700b3; }
        a { color: #6200ea; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="form-container">
        <h2>Submit ${bidRound} Bid</h2>
        <p>Time: ${selectedTime.toISOString()}</p>
        <form method="POST" action="/bid/submit">
          <input type="hidden" name="infrastructure_id" value="${infraID}">
          <input type="hidden" name="selected_time" value="${selectedTime.toISOString()}">
          <input type="hidden" name="level" value="${level}">
          <input type="hidden" name="bid_round" value="${bidRound}">
          ${level === '15min' ? `
            <label>Day-Ahead Allocated:</label>
            <input type="text" value="${dayAheadValues.allocated}" readonly>
            <label>Day-Ahead Price:</label>
            <input type="text" value="${dayAheadValues.price}" readonly>
          ` : ''}
          <label>Bid Price:</label>
          <input type="text" name="bid_price" value="${bidPrice}" ${editable ? '' : 'readonly'}>
          <label>Bid Value:</label>
          <input type="text" name="bid_value" value="${bidValue}" ${editable ? '' : 'readonly'}>
          <button type="submit" ${editable ? '' : 'disabled'}>Submit</button>
        </form>
        <a href="/bid?infrastructure_id=${infraID}">Back to Calendar</a>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// --- 7. Bid Submission Handler (POST /bid/submit) ---
app.post('/bid/submit', async (req, res) => {
  const { infrastructure_id, bid_round, bid_price, bid_value, selected_time, level } = req.body;
  const bidId = "BID" + crypto.randomBytes(4).toString('hex').toUpperCase();

  const finalBidPrice = replicateBid(level, bid_price, NaN);
  const finalBidValue = replicateBid(level, bid_value, 0);
  const len = Array.isArray(finalBidPrice) ? finalBidPrice.length : 1;

  const initialUpdate = {
    stage: "Submitted",
    status: "Pending",
    timestamp: new Date(),
    Allocated: bid_round === "Day-Ahead" ? Array(len).fill(0) : 0,
    Price: bid_round === "Day-Ahead" ? Array(len).fill("") : ""
  };

  const newBid = new Bid({
    bid_id: bidId,
    infrastructure_id,
    bid_round,
    bid_price: finalBidPrice,
    bid_value: finalBidValue,
    bid_submitted_timestamp: new Date(selected_time),
    last_updated: new Date(),
    bid_updates: [initialUpdate]
  });

  try {
    await newBid.save();
    res.redirect(`/bid?infrastructure_id=${encodeURIComponent(infrastructure_id)}`);
  } catch (err) {
    res.status(500).send("Error saving bid: " + err.message);
  }
});

// --- 8. Start Server ---
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
