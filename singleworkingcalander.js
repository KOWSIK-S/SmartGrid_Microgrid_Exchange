/*********************************************
 * bidding-app.js - Enhanced Calendar-based Bidding Application
 *
 * Features:
 *  - Drill-down UI (year > month > day > 6hr > hr > 15min) with modal choices.
 *  - For Day-Ahead bids, values are stored as a 24-element array.
 *      • "Bid Entire Day" fills the whole array.
 *      • Drilling down to 6hr or hr updates only the relevant indices.
 *  - 15-Minute bids remain separate (scalar value).
 *  - Bidding windows are time-dependent, but a DEBUG flag can force windows
 *    to always be editable for testing.
 *  - The bid submission page now auto-refreshes every 20 seconds.
 *********************************************/

const DEBUG = false; // Set to true for testing so bid windows are always editable.

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();
const port = 3000;

// --- MongoDB Connection ---
mongoose.connect('mongodb://localhost:27017/biddingdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB.");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// --- Bid Schema & Model ---
const bidSchema = new mongoose.Schema({
  bid_id: { type: String, required: true, unique: true },
  infrastructure_id: { type: String, required: true },
  bid_round: { 
    type: String, 
    enum: ["Day-Ahead", "15-Min", "Compensation"], 
    required: true 
  },
  // For Day-Ahead, bid_price & bid_value are 24-element arrays;
  // For 15-Min, they are scalars.
  bid_price: { type: mongoose.Schema.Types.Mixed, default: null },
  bid_value: { type: mongoose.Schema.Types.Mixed, default: null },
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
    Allocated: { type: mongoose.Schema.Types.Mixed, default: null },
    Price: { type: mongoose.Schema.Types.Mixed, default: null }
  }]
});
const Bid = mongoose.model('Bid', bidSchema);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------------------------------
// Utility Functions
// ---------------------------------
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

function getPeriodEnd(level, time) {
  const start = getPeriodStart(level, time);
  const date = new Date(start);
  if (level === 'day') {
    date.setUTCHours(23, 59, 59, 999);
  } else if (level === '6hr') {
    date.setUTCHours(date.getUTCHours() + 6);
    date.setMilliseconds(date.getMilliseconds() - 1);
  } else if (level === 'hr') {
    date.setUTCHours(date.getUTCHours() + 1);
    date.setMilliseconds(date.getMilliseconds() - 1);
  } else if (level === '15min') {
    date.setUTCMinutes(date.getUTCMinutes() + 15);
    date.setMilliseconds(date.getMilliseconds() - 1);
  }
  return date;
}

/**
 * Checks if the bid window is editable.
 * For Day-Ahead (for tomorrow): editable today between 14:00–17:00 UTC.
 * For 15min: editable 25–15 minutes before the slot.
 *
 * DEBUG mode forces editability.
 */
function isEditable(level, selectedTime) {
  if (DEBUG) return true;
  const now = new Date();
  const selected = new Date(selectedTime);
  if (level === 'day' || level === '6hr' || level === 'hr') {
    // Assume selected is for tomorrow.
    const dayBefore = new Date(selected);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    dayBefore.setUTCHours(14, 0, 0, 0);
    const endEdit = new Date(selected);
    endEdit.setUTCDate(endEdit.getUTCDate() - 1);
    endEdit.setUTCHours(17, 0, 0, 0);
    return now >= dayBefore && now < endEdit;
  } else if (level === '15min') {
    const startEdit = new Date(selected.getTime() - 25 * 60 * 1000);
    const endEdit = new Date(selected.getTime() - 15 * 60 * 1000);
    return now >= startEdit && now < endEdit;
  }
  return false;
}

/**
 * Fetch an existing Day-Ahead bid (24-element array) using the day start time.
 * For 15min bids, use an exact timestamp.
 */
async function fetchExistingBid(infraID, bidRound, selectedTime) {
  if (bidRound === 'Day-Ahead') {
    const dayStart = getPeriodStart('day', selectedTime);
    return await Bid.findOne({
      infrastructure_id: infraID,
      bid_round: bidRound,
      bid_submitted_timestamp: dayStart,
      '$expr': { $eq: [{ $size: "$bid_price" }, 24] }
    }).sort({ last_updated: -1 });
  } else {
    return await Bid.findOne({
      infrastructure_id: infraID,
      bid_round: bidRound,
      bid_submitted_timestamp: selectedTime,
      bid_price: { $type: "number" }
    }).sort({ last_updated: -1 });
  }
}

/**
 * For Day-Ahead bids, update the 24-element array.
 * - 'day': update all 24 hours.
 * - '6hr': update the block corresponding to the selected hour.
 * - 'hr': update that one hour.
 */
function updateDayAheadArrays(existingArray, level, selectedTime, bidInput) {
  const value = (bidInput && !isNaN(parseFloat(bidInput))) ? parseFloat(bidInput) : (level === 'day' ? NaN : 0);
  let newArray = [];
  if (existingArray && Array.isArray(existingArray) && existingArray.length === 24) {
    newArray = [...existingArray];
  } else {
    newArray = Array(24).fill(value);
  }
  
  if (level === 'day') {
    newArray = Array(24).fill(value);
  } else if (level === '6hr') {
    const hour = new Date(selectedTime).getUTCHours();
    const blockIndex = Math.floor(hour / 6);
    const startIndex = blockIndex * 6;
    for (let i = startIndex; i < startIndex + 6; i++) {
      newArray[i] = value;
    }
  } else if (level === 'hr') {
    const hour = new Date(selectedTime).getUTCHours();
    newArray[hour] = value;
  }
  return newArray;
}

// ---------------------------------
// Calendar Route (/bid)
// ---------------------------------
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
        #calendar { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
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
          <div id="modal-options"></div>
          <button id="cancel">Cancel</button>
        </div>
      </div>
      <script>
        const infraID = "${infraID}";
        let state = {
          view: 'year', // year -> month -> day -> 6hr -> hr -> 15min.
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
        const modalOptions = document.getElementById('modal-options');
        const cancelBtn = document.getElementById('cancel');

        function render() {
          calendar.innerHTML = '';
          let items = [];
          if (state.view === 'year') {
            title.textContent = state.year;
            items = Array.from({ length: 12 }, (_, i) =>
              new Date(state.year, i).toLocaleString('default', { month: 'long' })
            );
            back.style.display = 'none';
          } else if (state.view === 'month') {
            const d = new Date(state.year, state.month);
            title.textContent = d.toLocaleString('default', { month: 'long', year: 'numeric' });
            const days = new Date(state.year, state.month + 1, 0).getUTCDate();
            items = Array.from({ length: days }, (_, i) => i + 1);
            back.style.display = 'inline';
          } else {
            back.style.display = 'inline';
            if (state.view === 'day') {
              const dayStart = new Date(Date.UTC(state.year, state.month, state.day, 0, 0));
              title.textContent = dayStart.toUTCString().split(' ').slice(1,4).join(' ') + " (00:00–23:59)";
              items = ['Bid Entire Day', 'Drill Down to 6hr Blocks'];
            }
            else if (state.view === '6hr') {
              const blockStart = new Date(Date.UTC(state.year, state.month, state.day, state.block, 0));
              const blockEnd = new Date(blockStart);
              blockEnd.setUTCHours(blockEnd.getUTCHours() + 6);
              blockEnd.setMilliseconds(blockEnd.getMilliseconds() - 1);
              title.textContent = blockStart.toISOString().substr(11,5) + "–" + blockEnd.toISOString().substr(11,5);
              items = ['Bid Entire Block', 'Drill Down to Hours'];
            }
            else if (state.view === 'hr') {
              const hrStart = new Date(Date.UTC(state.year, state.month, state.day, state.hour, 0));
              const hrEnd = new Date(hrStart);
              hrEnd.setUTCHours(hrEnd.getUTCHours() + 1);
              hrEnd.setMilliseconds(hrEnd.getMilliseconds() - 1);
              title.textContent = hrStart.toISOString().substr(11,5) + "–" + hrEnd.toISOString().substr(11,5);
              items = ['Bid This Hour', 'Drill Down to 15min'];
            }
            else if (state.view === '15min') {
              const minStart = new Date(Date.UTC(state.year, state.month, state.day, state.hour, state.minute));
              const minEnd = new Date(minStart);
              minEnd.setUTCMinutes(minEnd.getUTCMinutes() + 15);
              minEnd.setMilliseconds(minEnd.getMilliseconds() - 1);
              title.textContent = minStart.toISOString().substr(11,5) + "–" + minEnd.toISOString().substr(11,5);
              items = ['Bid 15-Min Slot'];
            }
          }
          items.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'item';
            div.textContent = item;
            div.onclick = () => showModal(item, idx);
            calendar.appendChild(div);
          });
        }

        function showModal(item, idx) {
          modal.style.display = 'flex';
          modalText.textContent = 'Selected: ' + item;
          modalOptions.innerHTML = '';
          if (state.view === 'year') {
            addModalOption("Go to " + item + " " + state.year, () => {
              state.view = 'month';
              state.month = idx;
              modal.style.display = 'none';
              render();
            });
          } else if (state.view === 'month') {
            addModalOption("Go to Day " + item, () => {
              state.view = 'day';
              state.day = parseInt(item);
              modal.style.display = 'none';
              render();
            });
          }
          else if (state.view === 'day') {
            if(item === 'Bid Entire Day') {
              const d = new Date(Date.UTC(state.year, state.month, state.day, 0, 0));
              window.location.href = '/bid/submit?level=day&date=' + d.toISOString() + '&infrastructure_id=' + infraID;
            } else {
              state.view = '6hr';
              state.block = 0;
              modal.style.display = 'none';
              render();
            }
          }
          else if (state.view === '6hr') {
            if(item === 'Bid Entire Block') {
              const d = new Date(Date.UTC(state.year, state.month, state.day, state.block, 0));
              window.location.href = '/bid/submit?level=6hr&date=' + d.toISOString() + '&infrastructure_id=' + infraID;
            } else {
              state.view = 'hr';
              state.hour = state.block;
              modal.style.display = 'none';
              render();
            }
          }
          else if (state.view === 'hr') {
            if(item === 'Bid This Hour') {
              const d = new Date(Date.UTC(state.year, state.month, state.day, state.hour, 0));
              window.location.href = '/bid/submit?level=hr&date=' + d.toISOString() + '&infrastructure_id=' + infraID;
            } else {
              state.view = '15min';
              state.minute = 0;
              modal.style.display = 'none';
              render();
            }
          }
          else if (state.view === '15min') {
            if(item === 'Bid 15-Min Slot') {
              const d = new Date(Date.UTC(state.year, state.month, state.day, state.hour, state.minute));
              window.location.href = '/bid/submit?level=15min&date=' + d.toISOString() + '&infrastructure_id=' + infraID;
            }
          }
        }

        function addModalOption(text, callback) {
          const btn = document.createElement('button');
          btn.textContent = text;
          btn.onclick = callback;
          modalOptions.appendChild(btn);
        }

        cancelBtn.onclick = () => { modal.style.display = 'none'; };

        back.onclick = () => {
          const map = { '15min': 'hr', 'hr': '6hr', '6hr': 'day', 'day': 'month', 'month': 'year' };
          state.view = map[state.view] || 'year';
          render();
        };

        prev.onclick = () => {
          if(state.view === 'year') { state.year--; }
          else if(state.view === 'month') { state.month = (state.month - 1 + 12) % 12; }
          else if(state.view === 'day') { state.day = Math.max(1, state.day - 1); }
          else if(state.view === '6hr') { state.block = Math.max(0, state.block - 6); }
          else if(state.view === 'hr') { state.hour = Math.max(0, state.hour - 1); }
          else if(state.view === '15min') { state.minute = Math.max(0, state.minute - 15); }
          render();
        };

        next.onclick = () => {
          if(state.view === 'year') { state.year++; }
          else if(state.view === 'month') { state.month = (state.month + 1) % 12; }
          else if(state.view === 'day') { state.day++; }
          else if(state.view === '6hr') { state.block = Math.min(18, state.block + 6); }
          else if(state.view === 'hr') { state.hour = Math.min(23, state.hour + 1); }
          else if(state.view === '15min') { state.minute = Math.min(45, state.minute + 15); }
          render();
        };

        modal.onclick = (e) => { if(e.target === modal) modal.style.display = 'none'; };

        render();
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// ---------------------------------
// Bid Submission Form (/bid/submit)
// ---------------------------------
app.get('/bid/submit', async (req, res) => {
  const level = req.query.level || 'hr';
  const selectedTime = (level === '15min') 
    ? getPeriodStart('15min', req.query.date || new Date().toISOString())
    : getPeriodStart(level, req.query.date || new Date().toISOString());
  const infraID = req.query.infrastructure_id || "INF1001";
  const bidRound = level === '15min' ? '15-Min' : 'Day-Ahead';
  const editable = isEditable(level, selectedTime);

  let existingBid = null;
  if(bidRound === 'Day-Ahead') {
    existingBid = await fetchExistingBid(infraID, bidRound, selectedTime);
  } else {
    existingBid = await Bid.findOne({
      infrastructure_id: infraID,
      bid_round: bidRound,
      bid_submitted_timestamp: selectedTime,
      bid_price: { $type: "number" }
    }).sort({ last_updated: -1 });
  }

  let bidPrice, bidValue;
  if(editable) {
    bidPrice = '';
    bidValue = '';
  } else if(existingBid) {
    if(bidRound === 'Day-Ahead') {
      const dt = new Date(selectedTime);
      if(level === 'day') {
        bidPrice = existingBid.bid_price[0];
        bidValue = existingBid.bid_value[0];
      } else if(level === '6hr') {
        const hour = dt.getUTCHours();
        const blockIndex = Math.floor(hour / 6);
        bidPrice = existingBid.bid_price[blockIndex * 6];
        bidValue = existingBid.bid_value[blockIndex * 6];
      } else if(level === 'hr') {
        const hour = dt.getUTCHours();
        bidPrice = existingBid.bid_price[hour];
        bidValue = existingBid.bid_value[hour];
      }
    } else {
      bidPrice = existingBid.bid_price;
      bidValue = existingBid.bid_value;
    }
  } else {
    bidPrice = (bidRound === 'Day-Ahead' ? NaN : 0);
    bidValue = (bidRound === 'Day-Ahead' ? NaN : 0);
  }

  const dayAheadDisplay = (bidRound === '15-Min')
    ? `<p>Day-Ahead values (read-only) are not shown in 15-Min mode.</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="20">
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
        <h2>Submit ${bidRound} Bid (${level.toUpperCase()} Level)</h2>
        <p>Time Slot: ${selectedTime.toISOString()} to ${getPeriodEnd(level, selectedTime).toISOString()}</p>
        ${dayAheadDisplay}
        <form method="POST" action="/bid/submit">
          <input type="hidden" name="infrastructure_id" value="${infraID}">
          <input type="hidden" name="selected_time" value="${selectedTime.toISOString()}">
          <input type="hidden" name="level" value="${level}">
          <input type="hidden" name="bid_round" value="${bidRound}">
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

// ---------------------------------
// Bid Submission Handler (POST)
// ---------------------------------
app.post('/bid/submit', async (req, res) => {
  const { infrastructure_id, bid_round, bid_price, bid_value, selected_time, level } = req.body;
  const baseTime = (level === '15min') 
    ? getPeriodStart('15min', selected_time)
    : getPeriodStart('day', selected_time);
  const bidId = "BID" + crypto.randomBytes(4).toString('hex').toUpperCase();

  let newBidPrice, newBidValue;
  if(bid_round === "15-Min") {
    newBidPrice = bid_price && !isNaN(parseFloat(bid_price)) ? parseFloat(bid_price) : NaN;
    newBidValue = bid_value && !isNaN(parseFloat(bid_value)) ? parseFloat(bid_value) : 0;
  } else {
    let existingBid = await fetchExistingBid(infrastructure_id, bid_round, selected_time);
    let currentPrices = (existingBid && Array.isArray(existingBid.bid_price) && existingBid.bid_price.length === 24)
                          ? existingBid.bid_price 
                          : Array(24).fill(NaN);
    let currentValues = (existingBid && Array.isArray(existingBid.bid_value) && existingBid.bid_value.length === 24)
                          ? existingBid.bid_value 
                          : Array(24).fill(0);
    newBidPrice = updateDayAheadArrays(currentPrices, level, selected_time, bid_price);
    newBidValue = updateDayAheadArrays(currentValues, level, selected_time, bid_value);
  }

  const initialUpdate = {
    stage: "Submitted",
    status: "Pending",
    timestamp: new Date(),
    Allocated: (bid_round === "Day-Ahead") ? Array(24).fill(0) : 0,
    Price: (bid_round === "Day-Ahead") ? Array(24).fill("") : ""
  };

  if(bid_round === "Day-Ahead") {
    let existingBid = await fetchExistingBid(infrastructure_id, bid_round, selected_time);
    if(existingBid) {
      existingBid.bid_price = newBidPrice;
      existingBid.bid_value = newBidValue;
      existingBid.last_updated = new Date();
      existingBid.bid_updates.push(initialUpdate);
      try {
        await existingBid.save();
        return res.redirect(`/bid?infrastructure_id=${encodeURIComponent(infrastructure_id)}`);
      } catch (err) {
        return res.status(500).send("Error updating bid: " + err.message);
      }
    }
  }

  const newBid = new Bid({
    bid_id: bidId,
    infrastructure_id,
    bid_round,
    bid_price: newBidPrice,
    bid_value: newBidValue,
    bid_submitted_timestamp: baseTime,
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
