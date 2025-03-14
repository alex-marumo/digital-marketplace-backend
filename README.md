# **Digital Marketplace Backend**

## **📌 Overview**
This is the backend for the **Digital Marketplace**, a platform where artists can showcase and sell their artwork while buyers can purchase and review them. The backend is built using **Node.js, Express.js, and PostgreSQL**.

## **🚀 Features**

- **User & Account Management**
  - Automated user creation via Keycloak on first login.
  - Email verification and CAPTCHA to prevent duplicate accounts.
  - Role-based access: Buyers, Artists, and Admins.

- **Artist & Artwork Management**
  - Artists can create and update their profiles.
  - Artists can add, update, and delete artworks, with multiple image uploads.

- **Order & Checkout System**
  - Buyers can place orders and track their orders.
  - Detailed order items and payment records are maintained.

- **Payments & Transactions**
  - Secure payment processing with status updates.
  - Admin-only controls for managing payment statuses.

- **Reviews & Messaging**
  - Buyers can leave reviews on artworks.
  - Users can send messages to each other.

- **Search & Filtering**
  - Search artworks by title, artist name, or category.
  - Filter artworks and orders by various criteria.

- **Security & Anti-Abuse**
  - Rate limiting to mitigate abuse.
  - Email verification and CAPTCHA to reduce fraudulent registrations.
  - Detailed audit logging for critical transactions.

## **🛠 Tech Stack**
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Authentication:** Keycloak (with JWT tokens)
- **Session Store:** PostgreSQL-backed sessions (connect-pg-simple)
- **File Storage:** Local storage (for images, with paths stored in the database)
- **Additional Tools:** Nodemailer for email verification, Google reCAPTCHA for CAPTCHA verification

## **🏛️ Architecture & Business Rules**

- **Keycloak Integration:**  
  Centralized identity management with Keycloak handles user authentication, token issuance, and role enforcement. All protected endpoints require a valid JWT token that includes the user’s Keycloak ID and roles.
  
- **Email Verification & CAPTCHA:**  
  To prevent abuse, new users must verify their email address. A unique token is sent to the user’s email after solving a CAPTCHA challenge (e.g., via Google reCAPTCHA). Users remain at a low trust level until they verify their email.
  
- **Role-Based Access Control (RBAC):**  
  Roles are assigned in Keycloak and dictate access:
  - **Buyers:** Can place orders, leave reviews.
  - **Artists:** Can create and manage artwork.
  - **Admins:** Have elevated privileges, such as managing orders, payments, and categories.
  
- **Data Integrity & Transactions:**  
  Foreign key constraints ensure data consistency between users, artworks, orders, and payments. Each artwork can have multiple images stored and linked via an `artwork_images` table.
  
- **Audit & Security:**  
  Rate limiting, CAPTCHA, and audit logs protect the platform against abuse and fraud, ensuring that only verified and trusted users can access sensitive features.


## **🛠 Installation & Setup**
### **1️⃣ Clone the Repository**
```bash
`git clone https://github.com/your-username/digital-marketplace-backend.git`  
`cd digital-marketplace-backend`

### **2️⃣ Install Dependencies**
```bash
Run `npm install` to install all required packages
```

### **3️⃣ Configure Environment Variables**
Create a `.env` file in the root directory and add:
```env
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `KEYCLOAK_URL`
   - `KEYCLOAK_REALM`
   - `KEYCLOAK_CLIENT_ID`
   - `KEYCLOAK_CLIENT_SECRET`
   - `RECAPTCHA_SECRET_KEY`
```

### **4️⃣ Run Database Migrations**
Ensure your PostgreSQL database is running and apply any migrations or schema updates.
```bash
npx knex migrate:latest
```

### **5️⃣ Start the Server**
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## **📌 API Endpoints**
### User & Account
- **GET /api/users/me**  
  Fetch the authenticated user’s profile.  
- **PUT /api/users/me**  
  Update the authenticated user’s profile.

### Artist Management
- **POST /api/artists**  
  Create an artist profile (accessible only to users with the artist role).
- **GET /api/artists**  
  List all artist profiles.
- **GET /api/artists/{id}**  
  Fetch a specific artist profile.
- **PUT /api/artists/{id}**  
  Update an artist profile (artist only).

### Artwork Management
- **POST /api/artworks**  
  Add new artwork with an image upload (artist only).
- **POST /api/artworks/{id}/images**  
  Upload additional images for an artwork (artist only).
- **GET /api/artworks**  
  Retrieve a list of all artworks along with their images.
- **GET /api/artworks/{id}**  
  Get details of a single artwork.
- **PUT /api/artworks/{id}**  
  Update artwork details (artist only).
- **DELETE /api/artworks/{id}**  
  Delete an artwork (artist or admin).

### Categories
- **POST /api/categories**  
  Create a new category (admin only).
- **GET /api/categories**  
  Retrieve a list of all categories.
- **PUT /api/categories/{id}**  
  Update a category (admin only).

### Orders & Payments
- **POST /api/orders**  
  Place an order (buyer only).
- **GET /api/orders**  
  List orders for the authenticated user.
- **GET /api/orders/{id}**  
  Fetch details of a specific order.
- **PUT /api/orders/{id}/status**  
  Update order status (admin only).
- **POST /api/payments**  
  Create a payment record.
- **GET /api/payments/{order_id}**  
  Retrieve payment details for a specific order.
- **PUT /api/payments/{id}/status**  
  Update payment status (admin only).

### Reviews & Messaging
- **POST /api/reviews**  
  Submit a review for an artwork (buyer only).
- **GET /api/reviews/{artwork_id}**  
  List reviews for a specific artwork.
- **POST /api/messages**  
  Send a message to another user.

### Search
- **POST /api/search**  
  Search artworks by title, artist name, or category.

## **🛠 Contributing**
1. Fork the repository.
2. Create a new feature branch.
3. Commit your changes with clear commit messages.
4. Open a pull request for review.

## **📜 License**
This project is open-source under the **non-existent** license(**unlicensed😉**)

---
### **📌 Feel free to modify or expand this README as your project evolves. Let's build an amazing digital marketplace together! 🚀**

