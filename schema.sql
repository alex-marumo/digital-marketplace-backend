--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artist_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.artist_requests (
    request_id integer NOT NULL,
    user_id uuid NOT NULL,
    id_document_path text,
    proof_of_work_path text,
    status character varying(50) DEFAULT 'pending'::character varying,
    rejection_reason text,
    requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reviewed_at timestamp without time zone,
    reviewed_by uuid,
    selfie_path text,
    CONSTRAINT artist_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.artist_requests OWNER TO postgres;

--
-- Name: artist_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.artist_requests ALTER COLUMN request_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.artist_requests_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: artists; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.artists (
    user_id integer NOT NULL,
    bio text,
    portfolio character varying(2083)
);


ALTER TABLE public.artists OWNER TO postgres;

--
-- Name: artwork_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.artwork_images (
    image_id integer NOT NULL,
    artwork_id integer NOT NULL,
    image_path text NOT NULL
);


ALTER TABLE public.artwork_images OWNER TO postgres;

--
-- Name: artwork_images_image_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.artwork_images_image_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.artwork_images_image_id_seq OWNER TO postgres;

--
-- Name: artwork_images_image_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.artwork_images_image_id_seq OWNED BY public.artwork_images.image_id;


--
-- Name: artworks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.artworks (
    artwork_id integer NOT NULL,
    artist_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    category_id integer NOT NULL,
    price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT artworks_price_check CHECK ((price >= (0)::numeric))
);


ALTER TABLE public.artworks OWNER TO postgres;

--
-- Name: artworks_artwork_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.artworks_artwork_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.artworks_artwork_id_seq OWNER TO postgres;

--
-- Name: artworks_artwork_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.artworks_artwork_id_seq OWNED BY public.artworks.artwork_id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    category_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: categories_category_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.categories_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.categories_category_id_seq OWNER TO postgres;

--
-- Name: categories_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.categories_category_id_seq OWNED BY public.categories.category_id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    message_id integer NOT NULL,
    sender_id integer NOT NULL,
    receiver_id integer NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: messages_message_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_message_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_message_id_seq OWNER TO postgres;

--
-- Name: messages_message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.messages_message_id_seq OWNED BY public.messages.message_id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    order_item_id integer NOT NULL,
    order_id integer NOT NULL,
    artwork_id integer NOT NULL,
    quantity integer NOT NULL,
    price numeric(10,2) NOT NULL,
    CONSTRAINT order_items_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0))
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: order_items_order_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.order_items_order_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_items_order_item_id_seq OWNER TO postgres;

--
-- Name: order_items_order_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.order_items_order_item_id_seq OWNED BY public.order_items.order_item_id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    order_id integer NOT NULL,
    buyer_id integer NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT orders_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'canceled'::character varying])::text[]))),
    CONSTRAINT orders_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: orders_order_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.orders_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_order_id_seq OWNER TO postgres;

--
-- Name: orders_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.orders_order_id_seq OWNED BY public.orders.order_id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    payment_id integer NOT NULL,
    order_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_payment_id_seq OWNER TO postgres;

--
-- Name: payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_payment_id_seq OWNED BY public.payments.payment_id;


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reviews (
    review_id integer NOT NULL,
    artwork_id integer NOT NULL,
    user_id integer NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.reviews OWNER TO postgres;

--
-- Name: reviews_review_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reviews_review_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reviews_review_id_seq OWNER TO postgres;

--
-- Name: reviews_review_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reviews_review_id_seq OWNED BY public.reviews.review_id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_logs (
    id integer NOT NULL,
    event_type character varying(50),
    details text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.system_logs OWNER TO postgres;

--
-- Name: system_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_logs_id_seq OWNER TO postgres;

--
-- Name: system_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_logs_id_seq OWNED BY public.system_logs.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    keycloak_id uuid,
    is_verified boolean DEFAULT false,
    verification_token character varying(255),
    token_expires timestamp without time zone,
    trust_level integer DEFAULT 1,
    status text DEFAULT 'pending_email_verification'::text NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['buyer'::character varying, 'artist'::character varying, 'admin'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_user_id_seq OWNER TO postgres;

--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: verification_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.verification_codes (
    user_id character varying(255) NOT NULL,
    code character varying(6) NOT NULL,
    expires_at timestamp without time zone NOT NULL
);


ALTER TABLE public.verification_codes OWNER TO postgres;

--
-- Name: verification_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.verification_tokens (
    token_id integer NOT NULL,
    user_id uuid NOT NULL,
    token character varying(64) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    verified boolean DEFAULT false
);


ALTER TABLE public.verification_tokens OWNER TO postgres;

--
-- Name: verification_tokens_token_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.verification_tokens_token_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.verification_tokens_token_id_seq OWNER TO postgres;

--
-- Name: verification_tokens_token_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.verification_tokens_token_id_seq OWNED BY public.verification_tokens.token_id;


--
-- Name: artwork_images image_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artwork_images ALTER COLUMN image_id SET DEFAULT nextval('public.artwork_images_image_id_seq'::regclass);


--
-- Name: artworks artwork_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artworks ALTER COLUMN artwork_id SET DEFAULT nextval('public.artworks_artwork_id_seq'::regclass);


--
-- Name: categories category_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories ALTER COLUMN category_id SET DEFAULT nextval('public.categories_category_id_seq'::regclass);


--
-- Name: messages message_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ALTER COLUMN message_id SET DEFAULT nextval('public.messages_message_id_seq'::regclass);


--
-- Name: order_items order_item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items ALTER COLUMN order_item_id SET DEFAULT nextval('public.order_items_order_item_id_seq'::regclass);


--
-- Name: orders order_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders ALTER COLUMN order_id SET DEFAULT nextval('public.orders_order_id_seq'::regclass);


--
-- Name: payments payment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN payment_id SET DEFAULT nextval('public.payments_payment_id_seq'::regclass);


--
-- Name: reviews review_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews ALTER COLUMN review_id SET DEFAULT nextval('public.reviews_review_id_seq'::regclass);


--
-- Name: system_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs ALTER COLUMN id SET DEFAULT nextval('public.system_logs_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: verification_tokens token_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_tokens ALTER COLUMN token_id SET DEFAULT nextval('public.verification_tokens_token_id_seq'::regclass);


--
-- Data for Name: artist_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.artist_requests (request_id, user_id, id_document_path, proof_of_work_path, status, rejection_reason, requested_at, reviewed_at, reviewed_by, selfie_path) FROM stdin;
4	57959202-a4d0-4074-8a61-3dd3c4444b6f	\N	uploads\\artist_verification\\57959202-a4d0-4074-8a61-3dd3c4444b6f-1744975542403.png	pending	\N	2025-04-18 13:25:42.519458	\N	\N	\N
5	57959202-a4d0-4074-8a61-3dd3c4444b6f	\N	uploads\\artist_verification\\57959202-a4d0-4074-8a61-3dd3c4444b6f-1744977430592.png	pending	\N	2025-04-18 13:57:10.673394	\N	\N	\N
6	57959202-a4d0-4074-8a61-3dd3c4444b6f	uploads\\artist_verification\\57959202-a4d0-4074-8a61-3dd3c4444b6f-1745007691266.png	uploads\\artist_verification\\57959202-a4d0-4074-8a61-3dd3c4444b6f-1745007691275.png	pending	\N	2025-04-19 00:21:31.780576	\N	\N	\N
7	b144329c-c771-4a50-b3a5-2ea68ab04d71	uploads\\artist_verification\\b144329c-c771-4a50-b3a5-2ea68ab04d71-1745015989887.png	uploads\\artist_verification\\b144329c-c771-4a50-b3a5-2ea68ab04d71-1745015989893.png	pending	\N	2025-04-19 00:39:49.954953	\N	\N	\N
\.


--
-- Data for Name: artists; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.artists (user_id, bio, portfolio) FROM stdin;
\.


--
-- Data for Name: artwork_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.artwork_images (image_id, artwork_id, image_path) FROM stdin;
\.


--
-- Data for Name: artworks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.artworks (artwork_id, artist_id, title, description, category_id, price, created_at) FROM stdin;
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.categories (category_id, name, description) FROM stdin;
1	Paintings	Artworks created by applying paint to a surface, such as canvas, paper, or wood. This category includes various styles like oil, acrylic, watercolor, and mixed media, ranging from realistic to abstract representations.
2	Sculptures	Three-dimensional artworks crafted from materials like stone, metal, wood, or clay. Sculptures can be created through carving, modeling, casting, or assembling, and may represent figures, abstract forms, or functional objects.
3	Photography	Art captured through the lens of a camera, encompassing a wide range of styles including portrait, landscape, abstract, and documentary photography. This category celebrates the artist's eye for composition, light, and subject matter.
4	Graphic Art	Visual art created for communication purposes, often using digital tools or traditional methods like drawing and printmaking. This includes illustrations, posters, logos, and digital designs that blend creativity with functionality.
5	Ceramics	Artworks made from clay and other ceramic materials, shaped and then hardened by heat. This category includes pottery, figurines, tiles, and sculptural pieces, showcasing the artist's skill in form and glaze.
6	Textile Art	Art created using fabric, yarn, or other textile materials. Techniques may include weaving, embroidery, quilting, or dyeing, resulting in items like tapestries, wall hangings, or wearable art.
7	Jewelry Design	The art of creating decorative items worn for personal adornment, such as necklaces, rings, bracelets, and earrings. This category emphasizes craftsmanship, often using precious metals, gemstones, or unique materials.
8	Fashion Design	The creation of clothing and accessories that blend artistic vision with wearability. This category includes haute couture, ready-to-wear collections, and avant-garde designs that push the boundaries of style and function.
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.messages (message_id, sender_id, receiver_id, content, created_at) FROM stdin;
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_items (order_item_id, order_id, artwork_id, quantity, price) FROM stdin;
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (order_id, buyer_id, total_amount, status, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (payment_id, order_id, amount, status, created_at) FROM stdin;
\.


--
-- Data for Name: reviews; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reviews (review_id, artwork_id, user_id, rating, comment, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (sid, sess, expire) FROM stdin;
z1ws2Dp02YFTgrtwwhmUUByuagQ5Hny-	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:14:28
h4-7jtOBd_4Wv8Q5H1Q5N91ibQ73Jf41	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:14:28
u3cat79ntxFN-AZdQYq95JVUHuiulHWj	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:22:28
azpgCi_KLstZ0nQbLUVMQ5p4BwAgOk54	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:22:28
uGnqAw7upAskORi74FUqsoiXPCRgoayC	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:23:55
H46w_F2bjgj3M92Yib2fJ56EcvPkC6Mw	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:23:55
EWXiA--Ny33sxrA4nxs0AdI0oGF5r_dd	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:39:54
kzVeU55Kj08Hif6d86V216V4NRwmScsn	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:39:54
TMwpjD971FfSBgQwoY55TJvIJAi2h6kB	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:52:39
PuhXOuPZ8vsoWY13kTgMSjdNeh4oVduO	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:52:39
yauszBSXdqoPHSfly2z4FSnVqXjTgnXY	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:58:51
HTQUt5CbzP04J7VcWdIU6yRhrxRuaH5p	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:58:51
s7zS5Iz1jylpS03QgWhdmzLYvA3OY2RB	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 01:19:01
zKMBQQyP900nNTxUbqksvjBC9Iz3VtWE	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:25:22
H6qNFbkwNKb48yWFEiKEEaHhWdk61OmQ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:25:22
-y1h3pfl32PBoITXEJe67tNArwRfcW23	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:30:48
UUFe0Nt1IHwEW3WowgVywSiWzhzRAlwJ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:30:48
P9rWScyn8288y388UwxF0G0-to96TWOe	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:47:00
JIMSvniOxauMbu9qeDh2AcCNYIsb5tKZ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:47:00
70z7YEQ1Q-ODCVISm8TGkUo5HN7vAxZd	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 12:39:43
THJW0pXwb84I0GbP6Rw5E5anSkhg9-3z	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:05:25
7TQMGXXpGcAnYUG0g2b03rBSfqseP0mI	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:05:25
UgQWlahm0vj49RzSIb9b2FsNHcF-5knZ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:40:31
qewY-iwSJdqV-j6Jm-6JTU20R_vBN8MD	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:40:31
DY6zoZMjwY93tGIt7S74Pm_TaCjOqZFn	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:02:05
LZOr4ZSbCNHEorMFxG2DX8giuTr_SdKO	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:02:05
LYZX85gnz6P57LT9D-TNI_nyw4EYezyw	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:02:06
3y44n-spiAHIgGHFarpIxeJpDwMjIxnM	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 14:20:11
wdiLzxySV5Q38fEvuet9RPdMclCZAWHr	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:08
CJ1-SxaFXgZ_k0SJXTl7lBmnc-AIn8LN	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:09
jokD-hW54phnVFuk770eaaf5bdV3YlkP	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:10
mj9R5NYxUp6krucPJlRAMW0UiTt1_SUA	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:12
lBH8lZIv2tVUWYJvtGwyi4TUI9o9nXg9	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:47:26
7CbeOnHOotziw8QKaEL9f3yU3jh2aOD9	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:47:26
fDw7bPEwwg5Nobr2owpgy3ZyobmCLsZo	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/admin/artist-requests/7/file/id_document?auth_callback=1"}	2025-04-20 14:47:51
ZZJLFrrg-VZmUkNs2m-M7Qh6XXlZv3gr	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:11:42
eNpZOtZNXk2S3l0FmbO2WBmr1-g0VfDb	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:11:42
V5Jm-Af8yHPl_NU3f7OLqlRUD1Ci-HUa	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 22:20:33
Oh2zDLpaQxrsOonAEQz3bWq5EW2AiEaC	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 22:20:33
K9YAs7DK9JT8YYhvmkGab1q_2Q1iogMj	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:22:47
0VVPhNKtWHcnrNqtYnXpW4rzt5bdOopL	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:22:47
uqi3MYOM-CHYm8D8sg5VfnnDIPNAnIIi	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:38:23
cjhMWSSYgJuEKQv6JziKkwJD3wuYGMf_	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:38:23
4DsJ0ApxSmJD3NPbBZyKnFzmWqDANeeS	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:40:19
X_5aX75GlPVIq8C9N2v0EMJ5-EPsE4rZ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:40:19
Mx-_GxAtURCsrgkGh4GRU2tH-fkEc8mL	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:52:54
rz7G023vLG3Pm5djexzqRDGopfXPx0so	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:52:56
wcG24jNLP6i2F7kPesUnCOVpElKTdGu8	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:01:49
eL4L_tSx6nFUIHEXbFLLpI8AUagZOlVy	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:01:49
u-CG6hAe6HKyKssSB28oykXiTkFi1dQs	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:19:40
WtkchaYVcnAeqnuGY0-bYq7mONyeIIW-	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:19:40
j3uk7hNkwJlqg2epsgRQB5zvLkF_0LwR	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:28:52
j6QlPE9iRb31JbxtkiDEDlimhNvoz3yx	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:36:06
qmIEX0g6REgon8LZkueL4Zy2Tdw2wuMJ	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:36:06
_OKLQnuuas5facRsEPd8VhwKMUcPMd7T	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:29:23
0_j4K-7JRVOcgxNnRSnFSCJBdqB0cpGj	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:29:23
Or74XemuKPp9GcKvR4Nd7Qn99YNpNx_L	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:42:38
h1SOc0p2btxYuZDdNJt1KuLhvjEouVCB	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:42:38
AcFRNoM50fnVQt48HAFmee1VIq6x2YjO	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 13:37:22
j97Y7mZOGnHAbKr3oAE74wk-pDgKmFg2	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:47:40
WTm1yRprZVNGsJ6yzAdp-PNN2Jpb3iqA	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:47:40
GDnF7uSWpXVJuTxUmMEchrSrq0B9wZEB	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 14:08:42
Zs-baNZHXAfgZXjbRDEb9q6-oBMgw0Yw	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:20:29
3z84dM64lExYqr8S8N475fq_wVwfHF8a	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:20:29
qbEJ3UtwR_Sw5fQyKrLdLnyyjOx9R1sK	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:48
Mlb59XoLytsSvzLzqKoFXBQxGrJypbIh	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:57
FI_LdC8_OwoeYcq-ek-4pckuETtUkIkL	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:36:57
b7kZbtpNe_5MDufrIThNuKo5aikT5Yeh	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-19 21:03:35
jdhkgS-mHbfQi_yB0WgY1DMXxre0Ikin	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:13:50
ULRJqApVw3Zz-IDEBiswm4pAnifjxq5d	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-19 21:13:51
j_ArOMSCeiiitczo8zubLHbp44Z3rxfY	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:21:36
SEYOivfxUz6i5zfylCYvkIBAXDxIt7Zs	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 00:21:36
9RcVKcteQPAPKJyl6Xz7dNRT8M_MYvEj	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:23:30
vpm2RzmvfhJVFiEDhqGNeJUhPThlzkA8	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:23:30
hVKdsBQItkcbTPEIXY5E7JTgXjK4tBfM	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:39:34
o30XGq39AviUg_CzTLCM7k41rrODAo0M	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 00:39:34
CAQS4ivjXLhyzUz04Jx-jom_72KEYl9r	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 00:52:03
BRZetsdV9W6mErKvfAHbMOs63_xNWBNw	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 00:58:38
5r6vJ7G1Z5y1-pOF5kWkWGqgNhtcz4uY	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:02:46
ZYVv5Bb5wQfgIpwKCQfzjReELxqbMsq4	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:02:46
HVc65YWHAq0lGF98rB8gdU5O8QyAOn8g	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:25:04
YNbC8APRcobuXKsIn8YKZM5DULQVLRct	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:25:04
hMI68uI44cJ0wO6yHyXWQYsGrm_K_R8H	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 01:30:27
pJo5iaG_HrX5iwRW6-mEcwJqntDX6RCD	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:46:26
zFgctsB1VNBGJey2L4erTbowZdbfq2Bt	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 01:46:26
-cRaxdrLpIwKprEebpokFv9jYIJr7f4C	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:30:05
BeOaD5u_B9u3Mjn8uzZ4W-aq5qzg9W-6	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:30:12
gKVBKFQrAwFuQaLPlHuiqrSK97nbI3ft	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:30:12
w0eBRgTOXvL-WpVyTLx-ZalyI7yJRFEm	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:51:32
rpz1q33zFdcVr7GKxrf4H8Nc6IMSN5ZT	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 12:51:32
6uJ4hixJBGU9P7RYrVqy3aFL7Dy2ljDM	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:38:08
i6ELZxegpUhHXcwWTyvk77wHSGkPkNhm	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 13:38:08
E4n-hZ8cBi5NgkQxGM2NsAWuMjBGP6S-	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 13:54:42
81WaCgEbYBgW1OB4RfschtvCTCKzKF6I	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:09:01
FbWL1Y5z0f8vDzsUl03hIE6ab5YX4_FC	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:09:01
tfnZg-3o_Y4N5eEdO2iZ9aJne_rzBPGw	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value"}	2025-04-20 14:09:01
RHREa_izwfDMHIRjrapkHPP54JXbdbr7	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 14:35:49
F-n8Zrw67BU3Z3osiDxDoMHrSSIbXtMj	{"cookie":{"originalMaxAge":null,"expires":null,"secure":false,"httpOnly":true,"path":"/"},"test":"test-value","auth_redirect_uri":"http://localhost:3000/api/users/me?auth_callback=1"}	2025-04-20 14:47:12
\.


--
-- Data for Name: system_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.system_logs (id, event_type, details, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (user_id, name, email, role, created_at, keycloak_id, is_verified, verification_token, token_expires, trust_level, status) FROM stdin;
50	test user	testuser@example.com	buyer	2025-04-10 20:56:44.461693	38b9f317-ead0-42dc-80a8-5e49848725fe	t	\N	\N	1	verified
53	admin	alexmarumo16@gmail.com	admin	2025-04-16 00:19:05.469492	0a3c4fa9-4891-4777-8835-8534601f7dea	t	\N	\N	1	verified
51	test artist	testartist@example.com	artist	2025-04-10 20:58:16.303574	57959202-a4d0-4074-8a61-3dd3c4444b6f	t	\N	\N	1	pending_admin_review
52	test artist1	testartist1@example.com	artist	2025-04-11 00:42:51.455024	b144329c-c771-4a50-b3a5-2ea68ab04d71	t	\N	\N	1	pending_admin_review
\.


--
-- Data for Name: verification_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.verification_codes (user_id, code, expires_at) FROM stdin;
d3eb66ae-74c5-4557-83d3-68ca58fdaeca	288118	2025-04-09 23:51:29.009
34625c0d-b341-43b4-8615-e321b4a6d293	415818	2025-04-10 01:08:22.468
fa19a624-c913-4e04-9ff4-57326a253dbc	224541	2025-04-10 12:36:26.827
9db561c5-f090-4d23-9c94-c8b33376fb23	480354	2025-04-10 16:31:54.994
e49b00c1-1b10-48fe-8d26-5b5b4c592d37	421543	2025-04-10 16:53:45.472
\.


--
-- Data for Name: verification_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.verification_tokens (token_id, user_id, token, created_at, expires_at, verified) FROM stdin;
\.


--
-- Name: artist_requests_request_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.artist_requests_request_id_seq', 7, true);


--
-- Name: artwork_images_image_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.artwork_images_image_id_seq', 3, true);


--
-- Name: artworks_artwork_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.artworks_artwork_id_seq', 3, true);


--
-- Name: categories_category_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.categories_category_id_seq', 8, true);


--
-- Name: messages_message_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.messages_message_id_seq', 1, false);


--
-- Name: order_items_order_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.order_items_order_item_id_seq', 1, false);


--
-- Name: orders_order_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.orders_order_id_seq', 1, false);


--
-- Name: payments_payment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_payment_id_seq', 1, false);


--
-- Name: reviews_review_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reviews_review_id_seq', 1, false);


--
-- Name: system_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.system_logs_id_seq', 1, false);


--
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_user_id_seq', 53, true);


--
-- Name: verification_tokens_token_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.verification_tokens_token_id_seq', 1, false);


--
-- Name: artist_requests artist_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artist_requests
    ADD CONSTRAINT artist_requests_pkey PRIMARY KEY (request_id);


--
-- Name: artists artists_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (user_id);


--
-- Name: artwork_images artwork_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artwork_images
    ADD CONSTRAINT artwork_images_pkey PRIMARY KEY (image_id);


--
-- Name: artworks artworks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_pkey PRIMARY KEY (artwork_id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (category_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (message_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_item_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (payment_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: users unique_keycloak_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT unique_keycloak_id UNIQUE (keycloak_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: verification_codes verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_pkey PRIMARY KEY (user_id, code);


--
-- Name: verification_tokens verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: idx_sessions_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_expire ON public.sessions USING btree (expire);


--
-- Name: idx_verification_tokens_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_verification_tokens_token ON public.verification_tokens USING btree (token);


--
-- Name: artist_requests artist_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artist_requests
    ADD CONSTRAINT artist_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(keycloak_id) ON DELETE SET NULL;


--
-- Name: artist_requests artist_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artist_requests
    ADD CONSTRAINT artist_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(keycloak_id) ON DELETE CASCADE;


--
-- Name: artists artists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: artwork_images artwork_images_artwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artwork_images
    ADD CONSTRAINT artwork_images_artwork_id_fkey FOREIGN KEY (artwork_id) REFERENCES public.artworks(artwork_id) ON DELETE CASCADE;


--
-- Name: artworks artworks_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(user_id) ON DELETE CASCADE;


--
-- Name: artworks artworks_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(category_id) ON DELETE SET NULL;


--
-- Name: messages messages_receiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: order_items order_items_artwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_artwork_id_fkey FOREIGN KEY (artwork_id) REFERENCES public.artworks(artwork_id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: reviews reviews_artwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_artwork_id_fkey FOREIGN KEY (artwork_id) REFERENCES public.artworks(artwork_id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: verification_tokens verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(keycloak_id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO marketplace_user;


--
-- Name: TABLE artist_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.artist_requests TO marketplace_user;


--
-- Name: SEQUENCE artist_requests_request_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.artist_requests_request_id_seq TO marketplace_user;


--
-- Name: TABLE artists; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.artists TO marketplace_user;


--
-- Name: TABLE artwork_images; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.artwork_images TO marketplace_user;


--
-- Name: SEQUENCE artwork_images_image_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.artwork_images_image_id_seq TO marketplace_user;


--
-- Name: TABLE artworks; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.artworks TO marketplace_user;


--
-- Name: SEQUENCE artworks_artwork_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.artworks_artwork_id_seq TO marketplace_user;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.categories TO marketplace_user;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.messages TO marketplace_user;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_items TO marketplace_user;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.orders TO marketplace_user;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.payments TO marketplace_user;


--
-- Name: TABLE reviews; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.reviews TO marketplace_user;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sessions TO marketplace_user;


--
-- Name: TABLE system_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.system_logs TO marketplace_user;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO marketplace_user;


--
-- Name: SEQUENCE users_user_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.users_user_id_seq TO marketplace_user;


--
-- Name: TABLE verification_codes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.verification_codes TO marketplace_user;


--
-- Name: TABLE verification_tokens; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.verification_tokens TO marketplace_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO marketplace_user;


--
-- PostgreSQL database dump complete
--

