# **Digital Marketplace Backend**

## **📌 Overview**
This is the backend for the **Digital Marketplace**, a platform where artists can showcase and sell their artwork while buyers can purchase and review them. The backend is built using **Node.js, Express.js, and PostgreSQL**.

## **🚀 Features**
- **User Authentication & Role Management** (Buyer, Artist, Admin)
- **Artwork Management** (CRUD operations for artists & admins)
- **Order & Checkout System**
- **Payment Processing & Tracking**
- **Messaging System** (Buyers & artists can communicate)
- **Reviews & Ratings**
- **Category Filtering & Search**
- **JWT Authentication & Role-based Access**
- **Rate Limiting to Prevent Abuse**

## **🛠 Tech Stack**
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL with Knex.js
- **Authentication:** JWT (JSON Web Tokens)
- **Storage:** Local (for images, can be extended to cloud storage)
- **Security:** bcrypt (password hashing), rate limiting

## **🛠 Installation & Setup**
### **1️⃣ Clone the Repository**
```bash
git clone https://github.com/your-username/digital-marketplace-backend.git
cd digital-marketplace-backend
```

### **2️⃣ Install Dependencies**
```bash
npm install
```

### **3️⃣ Configure Environment Variables**
Create a `.env` file in the root directory and add:
```env
DATABASE_URL=postgres://username:password@localhost:5432/digital_marketplace
JWT_SECRET=your_secret_key
NODE_ENV=development
```

### **4️⃣ Run Database Migrations**
```bash
npx knex migrate:latest
```

### **5️⃣ Start the Server**
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## **📌 API Endpoints**
### **User Authentication**
- `POST /api/signup` → Register a new user
- `POST /api/login` → Authenticate user & return JWT
- `GET /api/users/me` → Fetch logged-in user profile (protected)

### **Artist & Artwork Management**
- `GET /api/artists` → Fetch all artists
- `POST /api/artists` → Create an artist profile (protected)
- `POST /api/artworks` → Add new artwork (only for artists)
- `PUT /api/artworks/:id` → Edit artwork (only by artist)
- `DELETE /api/artworks/:id` → Delete artwork (by artist/admin)

### **Order & Checkout System**
- `POST /api/orders` → Place an order (only for buyers)
- `GET /api/orders` → Fetch buyer's orders
- `PUT /api/orders/:id/status` → Update order status (admin only)

### **Payments & Transactions**
- `POST /api/payments` → Create a payment record
- `PUT /api/payments/:id/status` → Update payment status (admin only)

### **Filtering & Search**
- `GET /api/artworks?category=:id&artist=:id` → Filter artworks
- `POST /api/search` → Search artworks by title, artist name, or category

### **Reviews & Messaging**
- `POST /api/reviews` → Leave a review (only buyers)
- `POST /api/messages` → Buyers & artists can message each other

## **📌 Business Rules**
- Users must register with a **unique email**.
- Only **artists** can upload and manage artworks.
- **Buyers only** can place orders and leave reviews.
- **Admins** can manage categories and moderate content.
- JWT authentication is required for protected endpoints.
- Rate limiting: **100 requests per 15 minutes per IP**.

## **🛠 Contributing**
1. Fork the repository
2. Create a feature branch (`git checkout -b new-feature`)
3. Commit your changes (`git commit -m "Added new feature"`)
4. Push to the branch (`git push origin new-feature`)
5. Open a pull request

## **📜 License**
This project is open-source under the **Non-Existent**.

---
### **📌 Let's Build an Amazing Digital Marketplace Together! 🚀**

