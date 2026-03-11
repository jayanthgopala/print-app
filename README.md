# Print Shop File Transfer System

This repository contains the complete source code for the Print Shop File Transfer system.

## Transfer Architecture

- Frontend to PC transfer is direct using WebRTC data channels.
- Backend is used only for authentication, shop availability, and offer/answer/ICE signaling.
- File bytes must not be relayed through the backend WebSocket server.

## 📂 Project Structure

- **`backend/`**: Node.js Signaling Server (WebSocket).
- **`frontend/`**: React Web App (Customer Interface).
- **`pc-app/`**: Electron Desktop App (Shop Receiver).
- **`database/`**: SQL Schema for Supabase/PostgreSQL.

## 🚀 Getting Started

### 1. Database Setup
1.  Set up a PostgreSQL database (e.g., Supabase).
2.  Run the script in `database/schema.sql` to create tables.
3.  Insert a test shop manually in your DB tool:
    ```sql
    INSERT INTO shops (shop_code, email, password_hash, name) 
    VALUES ('SHOP001', 'test@shop.com', 'hash', 'My Print Shop') 
    RETURNING id;
    ```
4.  Copy the returned `id` (UUID). You will need this.
5.  Insert a subscription for that shop:
    ```sql
    INSERT INTO subscriptions (shop_id, expires_at) 
    VALUES ('<YOUR_UUID>', NOW() + INTERVAL '1 year');
    ```

### 2. Backend Setup
1.  Navigate to `backend/`:
    ```bash
    cd backend
    npm install
    ```
2.  Create `.env` file:
    ```bash
    cp .env.example .env
    ```
    *   Update `DATABASE_URL` with your PostgreSQL connection string.
3.  Generate a Test Token for your PC App:
    ```bash
    node scripts/generateToken.js <YOUR_SHOP_UUID>
    ```
    *   Copy the generated Token.
4.  Start the server:
    ```bash
    npm start
    ```

### 3. PC App Setup (Shop Side)
1.  Navigate to `pc-app/`:
    ```bash
    cd pc-app
    npm install
    ```
2.  Start the app:
    ```bash
    npm start
    ```
3.  In the App UI:
    *   **Shop ID**: Enter the UUID from Step 1.
    *   **Auth Token**: Enter the Token from Step 2.
    *   **Download Folder**: Choose where files should be saved.
    *   Click **Save & Connect**.
    *   Status should turn **Green (Online)**.

### 4. Frontend Setup (Customer Side)
1.  Navigate to `frontend/`:
    ```bash
    cd frontend
    npm install
    ```
2.  Start the dev server:
    ```bash
    npm run dev
    ```
3.  Open the browser with your Shop ID using your deployed frontend URL:
    *   `https://your-frontend.example/?shopId=<YOUR_SHOP_UUID>`
4.  Upload a file!

## ⚠️ Important Notes for Production

1.  **WebRTC & Electron**: The `pc-app` uses `wrtc`. Install dependencies inside `pc-app/` after pulling transport changes. If you encounter errors like "module not found" or DLL errors, you may need to rebuild it for Electron:
    ```bash
    npm install -g electron-rebuild
    cd pc-app
    npx electron-rebuild
    ```
2.  **SSL/HTTPS**: WebRTC requires HTTPS in production.
    *   Deploy Frontend to Vercel/Netlify (Auto HTTPS).
    *   Deploy Backend to a server with SSL (use Nginx or Heroku).
    *   Update `ws://` to `wss://` in `frontend/src/App.jsx` and `pc-app/main.js`.
3.  **STUN/TURN**: The code uses Google's public STUN server. For a commercial product, set up a TURN server (e.g., Coturn) to handle strict firewalls.

## 🛠️ Troubleshooting

-   **"Shop is Offline"**: Ensure the PC App is running and the Status is Green. Check Backend logs.
-   **"Subscription Expired"**: Check the `subscriptions` table in DB.
-   **Connection Failed**: If testing on different networks, you might need a TURN server.
