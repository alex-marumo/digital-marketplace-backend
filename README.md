---

# **Digital Marketplace Backend**

## **📌 Overview**
Welcome to the **Digital Marketplace Backend**—the gritty engine powering a platform where artists sling their masterpieces and buyers scoop ‘em up. Built with **Node.js, Express.js, and PostgreSQL**, this bad boy’s locked and loaded with Keycloak for auth, Nodemailer for email blasts, and a battle-hardened API that’s ready to scale.

## **🚀 Features**

- **User & Account Management**
  - Auto user creation via Keycloak on signup—email/password baked in.
  - Email verification with 6-digit codes (expires in 1 hour, because Gmail’s a slacker).
  - reCAPTCHA to keep the bots at bay.
  - Roles: **Buyers** shop, **Artists** create, **Admins** rule.

- **Artist & Artwork Management**
  - Artists craft profiles and drop artworks with multi-image uploads.
  - Edit or trash your creations—full control, no mercy.

- **Order & Checkout System**
  - Buyers order up, track their loot, and dig into order details.
  - Payments tie into orders with admin oversight.

- **Payments & Transactions**
  - Secure payment hooks (PayPal, Orange Money, MyZaka) with status updates.
  - Admins tweak payment states; artists get pinged on sales.

- **Reviews & Messaging**
  - Buyers rate artworks—stars and sass.
  - Direct messages between users—keep it civil or not, your call.

- **Search & Filtering**
  - Hunt artworks by title, artist, or category—fast and dirty.

- **Security & Anti-Abuse**
  - Rate limiting to choke out spammers.
  - Email verification + reCAPTCHA = no fake accounts.
  - Audit logs for when shit hits the fan.

## **🛠 Tech Stack**
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (with `users`, `artworks`, and more)
- **Auth**: Keycloak (JWTs, roles, and all that jazz)
- **Email**: Nodemailer (Gmail SMTP, because it’s free and slow)
- **Anti-Bot**: Google reCAPTCHA
- **File Storage**: Local uploads (paths in DB—keep it simple)

## **🏛️ Architecture & Business Rules**

- **Keycloak Integration**  
  Keycloak runs the show—users register via API, verify emails, then grab tokens with `grant_type=password`. Protected endpoints (`/api/users/me`, etc.) demand a valid JWT with `keycloak.protect()`. Roles (`buyer`, `artist`, `admin`) gatekeep access.

- **Email Verification**  
  Newbies get a 6-digit code emailed post-signup—verify it to flip `is_verified` to `true` and unlock the good stuff. Codes last 1 hour (extended from 10 mins—Gmail delays suck).

- **Role-Based Access Control (RBAC)**  
  - **Buyers**: Order, review, message.
  - **Artists**: Manage profiles/artworks, cash in on sales.
  - **Admins**: Oversee orders, payments, categories.

- **Data Integrity**  
  Foreign keys tie `users` to `artworks`, `orders`, and `payments`. Multi-image support via `artwork_images`.

- **Security**  
  Rate limiting, reCAPTCHA, and logs keep the riffraff out. Trust levels (`NEW`, `VERIFIED`) scale with user actions.

## **🛠 Installation & Setup**

### **1️⃣ Clone the Repo**
```bash
git clone https://github.com/your-username/digital-marketplace-backend.git
cd digital-marketplace-backend
```

### **2️⃣ Install Dependencies**
```bash
npm install
```

### **3️⃣ Configure Environment Variables**
Drop a `.env` in the root:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/marketplace
SESSION_SECRET=your-super-secret
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=digital-marketplace
KEYCLOAK_ADMIN_CLIENT_ID=admin-cli
KEYCLOAK_ADMIN_CLIENT_SECRET=your-admin-secret
KEYCLOAK_CLIENT_ID=digital-marketplace-backend
KEYCLOAK_CLIENT_SECRET=your-app-secret  # Omit if public client
RECAPTCHA_SECRET_KEY=your-recaptcha-secret
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=your-gmail@gmail.com
SYSTEM_USER_ID=your-system-user-uuid
PORT=3000
```

- **Keycloak**: Set up a realm (`digital-marketplace`), admin client (`admin-cli`), and app client (`digital-marketplace-backend`—public or confidential).
- **Email**: Use Gmail with an App Password (2FA on).

### **4️⃣ Run DB Migrations**
Spin up PostgreSQL, then:
```bash
npx knex migrate:latest
```

### **5️⃣ Fire It Up**
```bash
npm run dev
```
Hits `http://localhost:3000`. Swagger UI at `/api-docs`.

## **📌 API Endpoints**

### **User & Account**
- **`POST /api/pre-register`**  
  Sign up with email, name, password, reCAPTCHA. Triggers email verification.
- **`POST /api/verify-email-code`**  
  Verify with `code` and `email`—flips `is_verified`.
- **`POST /api/resend-verification-code`**  
  Resend code if Gmail’s napping.
- **`GET /api/users/me`** *(protected)*  
  Grab your profile—needs a Keycloak token.
- **`PUT /api/users/me`** *(protected)*  
  Update your name/email.

### **Artist Management**
- **`POST /api/artists`** *(artist)*  
  Create your artist profile.
- **`GET /api/artists`**  
  List all artists.
- **`GET /api/artists/{id}`**  
  Peek at an artist.
- **`PUT /api/artists/{id}`** *(artist)*  
  Tweak your profile.

### **Artwork Management**
- **`POST /api/artworks`** *(artist)*  
  Drop an artwork with an image.
- **`POST /api/artworks/{id}/images`** *(artist)*  
  Add more pics.
- **`GET /api/artworks`**  
  Browse all artworks.
- **`GET /api/artworks/{id}`**  
  Scope a single piece.
- **`PUT /api/artworks/{id}`** *(artist)*  
  Edit your work.
- **`DELETE /api/artworks/{id}`** *(artist/admin)*  
  Trash it.

### **Categories**
- **`POST /api/categories`** *(admin)*  
  Add a category.
- **`GET /api/categories`**  
  List ‘em.
- **`PUT /api/categories/{id}`** *(admin)*  
  Update one.

### **Orders & Payments**
- **`POST /api/orders`** *(buyer)*  
  Place an order.
- **`GET /api/orders`** *(protected)*  
  Your orders.
- **`GET /api/orders/{id}`** *(protected)*  
  Order details.
- **`PUT /api/orders/{id}/status`** *(admin)*  
  Update status.
- **`POST /api/payments`** *(protected)*  
  Start a payment.
- **`GET /api/payments/{order_id}`** *(protected)*  
  Payment status.
- **`PUT /api/payments/{id}/status`** *(admin)*  
  Finalize payment.

### **Reviews & Messaging**
- **`POST /api/reviews`** *(buyer)*  
  Rate an artwork.
- **`GET /api/reviews/{artwork_id}`**  
  See reviews.
- **`POST /api/messages`** *(protected)*  
  Send a message.

### **Search**
- **`POST /api/search`**  
  Hunt artworks by title, artist, or category.

## **🛠 Contributing**
1. Fork it.
2. Branch it: `git checkout -b feature/your-thing`.
3. Commit it: `git commit -m "Add some dope shit"`.
4. Push it: `git push origin feature/your-thing`.
5. PR it—let’s roast it together.

## **📜 License**
Unlicensed—free as a bird, no chains. Do what you want, just don’t blame me if it breaks!

---

### **📌 Notes**
- **Keycloak Token**: Hit `/realms/digital-marketplace/protocol/openid-connect/token` with `grant_type=password`—we’re still ironing out “Account not fully set up” kinks (check flows, required actions).
- **Gmail**: Codes might lag—1-hour expiration saves the day.

Let’s build this marketplace into a legend—drop a star if you’re vibing! 🚀

---