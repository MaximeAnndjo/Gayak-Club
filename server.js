// server.js
require('dotenv').config();                           // ← Load .env
const express = require('express');
const path    = require('path');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const admin   = require('firebase-admin');            // ← Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();                        // ← Firestore reference

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));       // Serve all HTML/CSS/JS here

// Create a listing → write to Firestore
app.post('/create-listing', async (req, res) => {
  const { userId, title, description, price } = req.body;
  if (!userId || !title || !description || price == null) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const docRef = await db.collection('listings').add({
      userId,
      title,
      description,
      price,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true, id: docRef.id });
  } catch (err) {
    console.error('Error adding listing:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Read all listings → fetch from Firestore
app.get('/listings', async (req, res) => {
  try {
    const snapshot = await db
      .collection('listings')
      .orderBy('createdAt', 'desc')
      .get();

    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.json(items);
  } catch (err) {
    console.error('Error reading listings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete a listing → delete Firestore doc
app.delete('/delete-listing/:id', async (req, res) => {
  const docId = req.params.id;
  try {
    await db.collection('listings').doc(docId).delete();
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(404).json({ error: 'Listing not found' });
  }
});

// Stripe checkout → look up Firestore doc, then create session
app.post('/checkout', async (req, res) => {
  const listingId = req.body.listingId;
  try {
    const doc = await db.collection('listings').doc(listingId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const listing = doc.data();
    const amount  = Math.round(listing.price * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: listing.title },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/submitted.html`,
      cancel_url:  `${req.protocol}://${req.get('host')}/index.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

app.listen(4242, () => 
  console.log('Server running on http://localhost:4242')
);
