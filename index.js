import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcryptjs";
import session from "express-session";
import { v4 as uuidv4 } from "uuid";



// Database connection setup
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "DBMS",
  password: "soormayee1",
  port: 5432,
});

const app = express();
const port = 3000;
app.use(express.static("public"));
// Makes session accessible in all EJS templates
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});
app.set('view engine', 'ejs');


// Connect to the database
(async () => {
  try {
    await db.connect();
    console.log("Connected to PostgreSQL");

    // Create users table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        new_id UUID PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);
    console.log("Users table checked/created");

    // Drop blog1 table if exists and recreate it to ensure UUID compatibility
   
    await db.query(`
      CREATE TABLE IF NOT EXISTS blog1 (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(255) NOT NULL,
        blog TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(new_id) ON DELETE CASCADE
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS likes (    
        id SERIAL PRIMARY KEY,
        blog_id INT NOT NULL,
        user_id UUID NOT NULL,
        FOREIGN KEY (blog_id) REFERENCES blog1(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(new_id) ON DELETE CASCADE
      );
    `);
    console.log("Blog table created with UUID foreign key");
  } catch (err) {
    console.error("Database connection error:", err);
  }
  await db.query("CREATE TABLE IF NOT EXISTS comments (id SERIAL PRIMARY KEY, blog_id INT NOT NULL, user_id UUID NOT NULL, comment TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW(), FOREIGN KEY (blog_id) REFERENCES blog1(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(new_id) ON DELETE CASCADE);");
  console.log("Comments table created with foreign keys");
})();




// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).send("Unauthorized");
  }
}

// Homepage Route
app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/allblogs", async (req, res) => {
  res.render("blogMain.ejs");
});

// Blog Page - Fetch All Blogs
app.get('/blogs', async (req, res) => {
  try {
    const selectedCategory = req.query.category;

    let blogsQuery = `
      SELECT 
        blog1.id,
        blog1.title,
        blog1.blog,
        blog1.category,
        blog1.created_at,
        users.email,
        COUNT(DISTINCT likes.id) AS like_count,
        COUNT(DISTINCT comments.id) AS comment_count
      FROM blog1
      LEFT JOIN users ON users.new_id = blog1.user_id
      LEFT JOIN likes ON likes.blog_id = blog1.id
      LEFT JOIN comments ON comments.blog_id = blog1.id
    `;

    const values = [];

    if (selectedCategory) {
      blogsQuery += ` WHERE blog1.category = $1`;
      values.push(selectedCategory);
    }

    blogsQuery += `
      GROUP BY blog1.id, users.email
      ORDER BY blog1.created_at DESC
    `;

    const { rows: blogs } = await db.query(blogsQuery, values);

    for (let blog of blogs) {
      const commentsQuery = `
        SELECT c.comment, c.created_at, u.email
        FROM comments c
        JOIN users u ON u.new_id = c.user_id
        WHERE c.blog_id = $1
        ORDER BY c.created_at DESC
      `;
      const commentsResult = await db.query(commentsQuery, [blog.id]);
      blog.comments = commentsResult.rows;
    }

    res.render('blogs', {
      blogs,
      session: req.session,
      selectedCategory: selectedCategory || null // ✅ This is KEY
    });
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.status(500).send('Server Error');
  }
});






// Blog Creation Page
app.get("/createBlog", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("createBlog.ejs");
});

// Blog Submission
app.post("/input", async (req, res) => {
  if (!req.session.userId) {
    console.error("User not logged in!");
    return res.status(401).send("You must be logged in to post a blog");
  }

  const userId = req.session.userId;
  const { blog, category, title } = req.body;

  try {
    await db.query(
      "INSERT INTO blog1 (user_id, blog, category, title) VALUES ($1, $2, $3, $4)",
      [userId, blog, category, title]
    );
    res.redirect("/blog");
  } catch (err) {
    console.error("Error inserting blog:", err);
    res.status(500).send("Database error");
  }
});

// Login Page
app.get("/login", (req, res) => {
  res.render("login.ejs");
});

// User Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.redirect('/login'); // No user
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.redirect('/login'); // Wrong password
    }

    // ✅ Save session correctly
    req.session.userId = user.new_id;
    req.session.email = user.email;

    res.redirect('/blogs');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Server Error');
  }
});


// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/createProfile", (req, res) => {
  res.render("createProfile.ejs");
});

app.post("/createProfile", async (req, res) => {
  const { email, password } = req.body;
  const new_id = uuidv4();
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (new_id, email, password) VALUES ($1, $2, $3)",
      [new_id, email, hashedPassword]
    );
    res.redirect("/login");
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).send("Database error");
  }
});

app.get("/about", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  try {
    const userId = req.session.userId;

    // Get user email (and optionally username if you have that field)
    const userResult = await db.query(
      "SELECT email FROM users WHERE new_id = $1",
      [userId]
    );

    const email = userResult.rows[0].email;

    // Get blog count
    const blogCountResult = await db.query(
      "SELECT COUNT(*) FROM blog1 WHERE user_id = $1",
      [userId]
    );
    
    const blogCount = blogCountResult.rows[0].count;
    const blogListResult = await db.query(
      "SELECT title, created_at FROM blog1 WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    const blogs = blogListResult.rows;

    // Send to EJS template
    res.render("about.ejs", {
      user: {
        email: email,
        username: email.split("@")[0], // Or use actual name if stored
        blogcount: blogCount,
        
        blogs: blogs,
      },
    });
  } catch (err) {
    console.error("Error loading profile:", err);
    res.status(500).send("Database error");
  }
});




app.get("/test", (req, res) => {
  res.render("test.ejs");
});

app.get("/books", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Books"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/tech", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Technology"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/health", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Health"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/travel", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Travel"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/food", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Food"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/fashion", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Fashion"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/sports", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Sports"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/entertainment", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Entertainment"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/lifestyle", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["Lifestyle"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});
app.get("/finance", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM blog1 WHERE category = $1", ["finance"]);
    res.render("blogs.ejs", { blogs: result.rows });
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).send("Database error");
  }
});

app.post('/comment/:id', async (req, res) => {
  const blogId = req.params.id;
  const userId = req.session.userId;
  const { comment_text } = req.body;
  const { category } = req.query;

  try {
    await db.query(
      'INSERT INTO comments (user_id, blog_id, comment) VALUES ($1, $2, $3)',
      [userId, blogId, comment_text]
    );
    const redirectUrl = category ? `/blogs?category=${encodeURIComponent(category)}` : '/blogs';
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Comment Error:', err);
    res.status(500).send('Error posting comment');
  }
});

app.get('/comments/:id', async (req, res) => {
  const blogId = req.params.id;

  try {
    const result = await db.query(
      'SELECT comments.*, users.email FROM comments JOIN users ON comments.user_id = users.new_id WHERE blog_id = $1 ORDER BY created_at DESC',
      [blogId]
    );

    res.render('comments.ejs', { comments: result.rows });
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).send("Database error");
  }
});



app.get('/likes/:id', async (req, res) => {
  const blogId = req.params.id;
  try {
    const result = await db.query(
      "SELECT COUNT(*) FROM likes WHERE blog_id = $1",
      [blogId]
    );
    res.json({ likes: result.rows[0].count });
  } catch (err) {
    console.error("Error fetching likes:", err);
    res.status(500).send("Database error");
  }
});
app.get("/comments",(req,res)=>{
  res.render("comments.ejs");
});

app.get('/blog', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT blog1.*, users.email, 
             COUNT(DISTINCT likes.id) AS like_count,
             COUNT(DISTINCT comments.id) AS comment_count
      FROM blog1
      LEFT JOIN users ON blog1.user_id = users.new_id
      LEFT JOIN likes ON blog1.id = likes.blog_id
      LEFT JOIN comments ON blog1.id = comments.blog_id
      GROUP BY blog1.id, users.email
      ORDER BY blog1.created_at DESC
    `);

    const blogs = result.rows;

    // fetch comments for each blog
    for (const blog of blogs) {
      const commentsResult = await db.query(`
        SELECT comments.*, users.email 
        FROM comments 
        JOIN users ON comments.user_id = users.new_id 
        WHERE blog_id = $1
        ORDER BY comments.created_at DESC
      `, [blog.id]);

      blog.comments = commentsResult.rows;
    }

    res.render('blogs', { blogs });
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.status(500).send("Error fetching blogs");
  }
});

app.post('/like/:blogId', async (req, res) => {
  const blogId = req.params.blogId;
  const userId = req.session.userId;
  const category = req.query.category;

  if (!userId) {
    return res.redirect('/login');
  }

  try {
    const checkLike = await db.query(
      'SELECT * FROM likes WHERE blog_id = $1 AND user_id = $2',
      [blogId, userId]
    );

    if (checkLike.rows.length === 0) {
      await db.query(
        'INSERT INTO likes (blog_id, user_id) VALUES ($1, $2)',
        [blogId, userId]
      );
    }

    if (category && category.trim() !== '') {
      res.redirect(`/blogs?category=${encodeURIComponent(category)}`);
    } else {
      res.redirect('/blogs');
    }
  } catch (err) {
    console.error('Error handling like:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.get("/delete/:id", async (req, res) => {
  const blogId = req.params.id;
  try {
    await db.query("DELETE FROM blog1 WHERE id = $1", [blogId]);
    res.redirect("/blog");
  } catch (err) {
    console.error("Error deleting blog:", err);
    res.status(500).send("Database error");
  }
});
app.get("/deleteComment/:id", async (req, res) => {
  const commentId = req.params.id;
  try {
    await db.query("DELETE FROM comments WHERE id = $1", [commentId]);
    res.redirect("/blog");
  } catch (err) {
    console.error("Error deleting comment:", err);
    res.status(500).send("Database error");
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});