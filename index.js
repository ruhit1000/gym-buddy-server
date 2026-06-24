const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// --- Middlewares Configuration ---
app.use(cors());
app.use(express.json());

// --- Database Configuration ---
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const database = client.db("gym-buddy");
    const usersCollection = database.collection("user");
    const classesCollection = database.collection("classes");
    const favoritesCollection = database.collection("favorites");
    const sessionCollection = database.collection("session");
    const forumPostsCollection = database.collection("forumPosts");
    const commentsCollection = database.collection("comments");

    // --- Authentication & Authorization Middlewares ---
    const verifyToken = async (req, res, next) => {
      const authHeader = req?.headers?.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      const query = { token: token };
      const session = await sessionCollection.findOne(query);
      if (!session) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      const userId = session?.userId;
      const user = await usersCollection.findOne({ _id: userId });
      if (!user) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      req.user = user;
      next();
    };

    const verifyAdmin = async (req, res, next) => {
      if (req.user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    const verifyTrainer = async (req, res, next) => {
      if (req.user?.role !== "trainer") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    const verifyUser = async (req, res, next) => {
      if (req.user?.role !== "user") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    const checkBlock = async (req, res, next) => {
      const userRecord = await usersCollection.findOne({
        _id: new ObjectId(req.user._id),
      });

      if (userRecord && userRecord.status === "blocked") {
        return res.status(403).send({
          success: false,
          message: "Action restricted by Admin",
        });
      }
      next();
    };

    // =========================================================================
    // 1. PUBLIC BASE CATALOG & CATEGORIES ROUTES
    // =========================================================================

    // Server Health Check Ping
    app.get("/", (req, res) => {
      res.status(200).send("Hello World!");
    });

    // Get Approved Classes Catalog (With Search, Filter, Pagination)
    app.get("/api/classes", async (req, res) => {
      try {
        const { search, category, page = 1, limit = 15 } = req.query;
        const query = { status: "Approved" };

        // Apply fallback search string text pattern matching validation
        if (search && search.trim() !== "") {
          query.className = { $regex: search.trim(), $options: "i" };
        }

        // Apply multi-category filtering intersection selection matrix
        if (category && category.trim() !== "") {
          const categoryArray = category.split(",").map((cat) => cat.trim());
          query.category = { $in: categoryArray };
        }

        const pageNumber = parseInt(page, 10);
        const limitNumber = parseInt(limit, 10);
        const skipOffset = (pageNumber - 1) * limitNumber;

        // Run cursor database aggregation lookups in parallel
        const [classes, totalCount] = await Promise.all([
          classesCollection
            .find(query)
            .skip(skipOffset)
            .limit(limitNumber)
            .toArray(),
          classesCollection.countDocuments(query),
        ]);

        const totalPages = Math.ceil(totalCount / limitNumber);

        res.status(200).send({
          success: true,
          data: classes,
          meta: {
            totalItems: totalCount,
            totalPages,
            currentPage: pageNumber,
            limit: limitNumber,
            hasNextPage: pageNumber < totalPages,
            hasPrevPage: pageNumber > 1,
          },
        });
      } catch (error) {
        console.error("Error retrieving public classes catalog:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching classes catalog.",
        });
      }
    });

    // Get All Submitted Classes Across All Status States
    app.get(
      "/api/classes/manage",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const classes = await classesCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
          res
            .status(200)
            .send({ success: true, count: classes.length, data: classes });
        } catch (error) {
          console.error("Error fetching submitted classes directory:", error);
          res.status(500).send({
            success: false,
            message:
              "Internal server error while retrieving administrative classes workspace.",
          });
        }
      },
    );

    // Get All Forum Posts (Newest First)
    app.get("/api/forum", async (req, res) => {
      try {
        const { search, page = 1, limit = 15 } = req.query;
        const query = {};

        if (search && search.trim() !== "") {
          query.title = { $regex: search.trim(), $options: "i" };
        }

        const pageNumber = parseInt(page, 10);
        const limitNumber = parseInt(limit, 10);
        const skipOffset = (pageNumber - 1) * limitNumber;

        const [posts, totalCount] = await Promise.all([
          forumPostsCollection
            .find(query)
            .skip(skipOffset)
            .limit(limitNumber)
            .sort({ createdAt: -1 })
            .toArray(),
          forumPostsCollection.countDocuments(query),
        ]);

        const totalPages = Math.ceil(totalCount / limitNumber);

        res.status(200).send({
          success: true,
          data: posts,
          meta: {
            totalItems: totalCount,
            totalPages,
            currentPage: pageNumber,
            limit: limitNumber,
            hasNextPage: pageNumber < totalPages,
            hasPrevPage: pageNumber > 1,
          },
        });
      } catch (error) {
        console.error("Error retrieving forum posts directory:", error);
        res.status(500).send({
          success: false,
          message:
            "Internal server error while fetching community forum posts.",
        });
      }
    });

    // Create New Community Forum Post (Trainers & Admins Only)
    app.post("/api/forum", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const { title, description, image } = req.body;

        if (user.role !== "trainer" && user.role !== "admin") {
          return res.status(403).send({
            success: false,
            message:
              "Access denied. Only trainers and administrators can publish forum topics.",
          });
        }

        if (!title || title.trim() === "") {
          return res
            .status(400)
            .send({ success: false, message: "A post title is required." });
        }
        if (!description || description.trim() === "") {
          return res.status(400).send({
            success: false,
            message: "A post description body is required.",
          });
        }

        const newPostDoc = {
          title: title.trim(),
          description: description.trim(),
          image: image || "",
          authorId: new ObjectId(user._id),
          authorName: user.name || "Anonymous Staff",
          authorRole: user.role, // Saves either 'trainer' or 'admin'
          likes: [],
          dislikes: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await forumPostsCollection.insertOne(newPostDoc);

        if (result.insertedId) {
          res.status(201).send({
            success: true,
            message: "Forum post published successfully.",
            postId: result.insertedId,
          });
        } else {
          res.status(500).send({
            success: false,
            message: "Failed to persist forum post in database.",
          });
        }
      } catch (error) {
        console.error("Error creating new forum post:", error);
        res.status(500).send({
          success: false,
          message:
            "Internal server error while compiling forum post submission.",
        });
      }
    });

    // Get Unique List of Available Categories Across Approved Curriculums
    app.get("/api/categories", async (req, res) => {
      try {
        const categoriesPipeline = await classesCollection
          .aggregate([
            { $match: { status: "Approved" } },
            { $group: { _id: "$category" } },
            { $match: { _id: { $ne: null } } },
          ])
          .toArray();

        const cleanCategories = categoriesPipeline.map((item) => item._id);

        res.status(200).send({
          success: true,
          data: cleanCategories,
        });
      } catch (error) {
        console.error("Error retrieving unique categories:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching categories.",
        });
      }
    });

    // =========================================================================
    // 2. TRAINER CURRICULUM MANAGEMENT ROUTES (PROTECTED)
    // =========================================================================

    // Get Logged In Trainer's Specific Classes
    app.get("/api/classes/my-classes", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const query = { trainerId: user._id.toString() };
        const result = await classesCollection.find(query).toArray();

        res.status(200).send(result);
      } catch (error) {
        console.error("Error retrieving trainer classes:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Create New Class Entry
    app.post("/api/classes", verifyToken, verifyTrainer, async (req, res) => {
      try {
        const newClass = req.body;
        const result = await classesCollection.insertOne(newClass);

        if (result.insertedId) {
          res
            .status(201)
            .send({ success: true, message: "Class created successfully" });
        } else {
          res
            .status(500)
            .send({ success: false, message: "Failed to create class" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Delete Targeted Class Entry
    app.delete("/api/classes/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await classesCollection.deleteOne(query);

        if (result.deletedCount === 1) {
          res
            .status(200)
            .send({ success: true, message: "Class deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Class not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Partial Edit Update Class Meta Property Attributes
    app.patch("/api/classes/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedClass = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: updatedClass };

        const result = await classesCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount === 1) {
          res
            .status(200)
            .send({ success: true, message: "Class updated successfully" });
        } else {
          res.status(404).send({ success: false, message: "Class not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Fetch Details for a Single Specific Class
    app.get("/api/classes/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await classesCollection.findOne(query);

        if (result) {
          res.status(200).send({ success: true, data: result });
        } else {
          res.status(404).send({ success: false, message: "Class not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Get Logged In User's Specific Forum Posts (Protected)
    app.get("/api/forum/my-posts", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const query = { authorId: new ObjectId(user._id) };

        const posts = await forumPostsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send({
          success: true,
          data: posts,
        });
      } catch (error) {
        console.error("Error retrieving personal forum posts:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching your posts.",
        });
      }
    });

    // Delete a Specific Forum Post (Author Only)
    app.delete("/api/forum/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const user = req.user;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid post ID format." });
        }

        const targetPost = await forumPostsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!targetPost) {
          return res
            .status(404)
            .send({ success: false, message: "Forum post not found." });
        }

        const isAuthor = targetPost.authorId.toString() === user._id.toString();

        if (!isAuthor) {
          return res.status(403).send({
            success: false,
            message:
              "Unauthorized action. You can only delete your own forum posts.",
          });
        }

        await Promise.all([
          forumPostsCollection.deleteOne({ _id: new ObjectId(id) }),
          commentsCollection.deleteMany({ postId: new ObjectId(id) }),
        ]);

        res.status(200).send({
          success: true,
          message: "Forum thread permanently removed.",
        });
      } catch (error) {
        console.error("Error deleting forum post:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error deleting post.",
        });
      }
    });

    // =========================================================================
    // 3. USER PROFILE, VERIFICATION, & REACTION ROUTES
    // =========================================================================

    // Fetch Details for Currently Authenticated Profile Session
    app.get("/api/users/me", verifyToken, async (req, res) => {
      try {
        const tokenUser = req.user;
        const user = await usersCollection.findOne({
          _id: new ObjectId(tokenUser._id),
        });

        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User profile record not found.",
          });
        }

        res.status(200).send({ success: true, data: user });
      } catch (error) {
        console.error("Error retrieving user profile information:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching user profile data.",
        });
      }
    });

    // Submit New Verification Professional Application Form to Become a Trainer
    app.post(
      "/api/users/apply-trainer",
      verifyToken,
      checkBlock,
      async (req, res) => {
        try {
          const user = req.user;
          const { experience, specialties } = req.body;

          if (
            !experience ||
            !specialties ||
            !Array.isArray(specialties) ||
            specialties.length === 0
          ) {
            return res.status(400).send({
              success: false,
              message:
                "Missing required profile details: experience or specialties.",
            });
          }

          const filter = { _id: new ObjectId(user._id) };
          const updateDoc = {
            $set: {
              trainerApplication: "pending",
              trainerApplicationDetails: {
                experience: parseInt(experience, 10),
                specialties: specialties,
                appliedAt: new Date(),
              },
            },
          };

          const result = await usersCollection.updateOne(filter, updateDoc);

          if (result.modifiedCount === 1) {
            res.status(200).send({
              success: true,
              message:
                "Application submitted successfully. Status updated to pending.",
            });
          } else {
            res.status(404).send({
              success: false,
              message: "User profile record not found or data unchanged.",
            });
          }
        } catch (error) {
          console.error(
            "Error processing trainer application submission:",
            error,
          );
          res.status(500).send({
            success: false,
            message:
              "Internal server error while compiling trainer verification records.",
          });
        }
      },
    );

    // Toggle Favorite Action Matrix (Add or Remove)
    app.post("/api/favorites/toggle", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const { classId } = req.body;

        if (!classId) {
          return res.status(400).send({
            success: false,
            message: "Missing required field: classId",
          });
        }

        const query = {
          userId: new ObjectId(user._id),
          classId: new ObjectId(classId),
        };

        const existingFavorite =
          await favoritesCollection.findOneAndDelete(query);

        if (existingFavorite) {
          return res.status(200).send({
            success: true,
            isFavorited: false,
            message: "Removed from favorites successfully.",
          });
        }

        const newFavoriteDoc = { ...query, createdAt: new Date() };
        await favoritesCollection.insertOne(newFavoriteDoc);

        res.status(201).send({
          success: true,
          isFavorited: true,
          message: "Added to favorites successfully.",
        });
      } catch (error) {
        console.error("Error toggling favorite class state:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while processing favorite updates.",
        });
      }
    });

    // Verify If Target Class Entry Exists On Current Profile Favorite Registry
    app.get("/api/favorites/check", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const { classId } = req.query;

        if (!classId) {
          return res.status(400).send({
            success: false,
            message: "Missing parameter: classId is required",
          });
        }

        const query = {
          userId: new ObjectId(user._id),
          classId: new ObjectId(classId),
        };

        const count = await favoritesCollection.countDocuments(query);
        res.status(200).send({ success: true, isFavorited: count > 0 });
      } catch (error) {
        console.error("Error verifying class favorite criteria state:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while checking favorite status.",
        });
      }
    });

    // Fetch Complete Aggregated Pipeline Registry of User Favorites
    app.get("/api/favorites/my-favorites", verifyToken, async (req, res) => {
      try {
        const user = req.user;
        const pipeline = [
          { $match: { userId: new ObjectId(user._id) } },
          {
            $lookup: {
              from: "classes",
              localField: "classId",
              foreignField: "_id",
              as: "classDetails",
            },
          },
          { $unwind: "$classDetails" },
          {
            $project: {
              _id: 1,
              createdAt: 1,
              classId: 1,
              classData: {
                _id: "$classDetails._id",
                className: "$classDetails.className",
                price: "$classDetails.price",
                duration: "$classDetails.duration",
                totalSlots: "$classDetails.totalSlots",
                bookingCount: "$classDetails.bookingCount",
                intensity: "$classDetails.intensity",
                category: "$classDetails.category",
                image: "$classDetails.image",
              },
            },
          },
        ];

        const result = await favoritesCollection.aggregate(pipeline).toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error("Error retrieving my favorites via aggregation:", error);
        res.status(500).send({
          success: false,
          message:
            "Internal server error while retrieving aggregated favorites.",
        });
      }
    });

    // Fetch Details and All Associated Comments for a Single Specific Post
    app.get("/api/forum/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid post ID format." });
        }

        const postQuery = { _id: new ObjectId(id) };
        const commentsQuery = { postId: new ObjectId(id) };

        const [post, comments] = await Promise.all([
          forumPostsCollection.findOne(postQuery),
          commentsCollection
            .find(commentsQuery)
            .sort({ createdAt: 1 })
            .toArray(),
        ]);

        if (!post) {
          return res
            .status(404)
            .send({ success: false, message: "Forum post not found." });
        }

        res.status(200).send({
          success: true,
          data: {
            post,
            comments,
          },
        });
      } catch (error) {
        console.error("Error retrieving forum post details:", error);
        res.status(500).send({
          success: false,
          message:
            "Internal server error while loading discussion thread details.",
        });
      }
    });

    // Create a New Comment Entry under a Targeted Post (Protected)
    app.post(
      "/api/forum/:id/comments",
      verifyToken,
      checkBlock,
      async (req, res) => {
        try {
          const id = req.params.id;
          const user = req.user;
          const { text } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({
              success: false,
              message: "Invalid post target format reference.",
            });
          }
          if (!text || text.trim() === "") {
            return res.status(400).send({
              success: false,
              message: "Comment body text cannot be empty.",
            });
          }

          const newCommentDoc = {
            postId: new ObjectId(id),
            userId: new ObjectId(user._id),
            userName: user.name || "Anonymous Member",
            userImage: user.image || "",
            text: text.trim(),
            createdAt: new Date(),
          };

          const result = await commentsCollection.insertOne(newCommentDoc);

          if (result.insertedId) {
            res.status(201).send({
              success: true,
              message: "Comment published successfully.",
              data: { _id: result.insertedId, ...newCommentDoc },
            });
          } else {
            res.status(500).send({
              success: false,
              message: "Failed to persist comment data record.",
            });
          }
        } catch (error) {
          console.error("Error committing comment entry submission:", error);
          res.status(500).send({
            success: false,
            message:
              "Internal server error while finalizing comment submission.",
          });
        }
      },
    );

    // Handle Like/Dislike Vote Toggles for a Post (Protected)
    app.patch("/api/forum/:id/vote", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const userId = req.user._id;
        const { action } = req.body;

        if (!ObjectId.isValid(id) || !["like", "dislike"].includes(action)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid parameters specified." });
        }

        const userObjId = new ObjectId(userId);
        const post = await forumPostsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!post)
          return res
            .status(404)
            .send({ success: false, message: "Post not found." });

        const likes = post.likes || [];
        const dislikes = post.dislikes || [];

        const hasLiked = likes.some((id) => id.toString() === userId);
        const hasDisliked = dislikes.some((id) => id.toString() === userId);

        let updateOperator = {};

        if (action === "like") {
          if (hasLiked) {
            updateOperator = { $pull: { likes: userObjId } };
          } else {
            updateOperator = {
              $addToSet: { likes: userObjId },
              $pull: { dislikes: userObjId },
            };
          }
        } else if (action === "dislike") {
          if (hasDisliked) {
            updateOperator = { $pull: { dislikes: userObjId } };
          } else {
            updateOperator = {
              $addToSet: { dislikes: userObjId },
              $pull: { likes: userObjId },
            };
          }
        }

        await forumPostsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateOperator,
        );

        const updatedPost = await forumPostsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.status(200).send({
          success: true,
          likes: updatedPost.likes || [],
          dislikes: updatedPost.dislikes || [],
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Internal server error updating vote metrics.",
        });
      }
    });

    // Update a Specific User Comment (Protected)
    app.patch(
      "/api/forum/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { commentId } = req.params;
          const { text } = req.body;
          const userId = req.user._id;

          if (!text || text.trim() === "") {
            return res.status(400).send({
              success: false,
              message: "Text content cannot be left empty.",
            });
          }

          const filter = {
            _id: new ObjectId(commentId),
            userId: new ObjectId(userId),
          };
          const result = await commentsCollection.updateOne(filter, {
            $set: { text: text.trim() },
          });

          if (result.modifiedCount === 1) {
            res.status(200).send({
              success: true,
              message: "Comment updated successfully.",
            });
          } else {
            res.status(404).send({
              success: false,
              message: "Comment not found or unauthorized deletion target.",
            });
          }
        } catch (error) {
          res.status(500).send({
            success: false,
            message: "Internal server error updating comment data.",
          });
        }
      },
    );

    // Delete a Specific User Comment (Protected)
    app.delete(
      "/api/forum/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { commentId } = req.params;
          const userId = req.user._id;

          const filter = {
            _id: new ObjectId(commentId),
            userId: new ObjectId(userId),
          };
          const result = await commentsCollection.deleteOne(filter);

          if (result.deletedCount === 1) {
            res.status(200).send({
              success: true,
              message: "Comment dropped successfully.",
            });
          } else {
            res.status(404).send({
              success: false,
              message: "Comment not found or unauthorized deletion target.",
            });
          }
        } catch (error) {
          res.status(500).send({
            success: false,
            message: "Internal server error processing comment drop request.",
          });
        }
      },
    );

    // =========================================================================
    // 4. ADMINISTRATIVE MODERATION & USER MANAGEMENT ROUTES (ADMIN ONLY)
    // =========================================================================

    // Get All User Registration Profiles For Management Table
    app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const options = {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            status: 1,
          },
        };
        const users = await usersCollection.find({}, options).toArray();

        const cleanUsers = users.map((user) => ({
          ...user,
          status: user.status || "active",
        }));

        res.status(200).send({ success: true, data: cleanUsers });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Update User Operational Profile States (Block / Unblock / Promoted Admin)
    app.patch(
      "/api/users/manage",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { userId, action } = req.body;

          if (!userId || !["block", "unblock", "make-admin"].includes(action)) {
            return res
              .status(400)
              .send({ success: false, message: "Invalid payload parameters." });
          }

          const filter = { _id: new ObjectId(userId) };
          let updateDoc = {};

          if (action === "block") {
            updateDoc = { $set: { status: "blocked" } };
          } else if (action === "unblock") {
            updateDoc = { $set: { status: "active" } };
          } else if (action === "make-admin") {
            updateDoc = { $set: { role: "admin" } };
          }

          const result = await usersCollection.updateOne(filter, updateDoc);

          if (result.modifiedCount === 1) {
            res.status(200).send({
              success: true,
              message: `User successfully updated via: ${action}`,
            });
          } else {
            res.status(404).send({
              success: false,
              message: "User not found or no changes made.",
            });
          }
        } catch (error) {
          res.status(500).send({
            success: false,
            message: "Internal server error updating user configurations.",
          });
        }
      },
    );

    // Moderate Curriculum Proposals Lifecycle (Approve / Reject / Permanent Delete)
    app.patch(
      "/api/classes/manage/review",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { classId, action } = req.body;

          if (!classId || !["approve", "reject", "delete"].includes(action)) {
            return res.status(400).send({
              success: false,
              message: "Invalid action payload context parameters.",
            });
          }

          const filter = { _id: new ObjectId(classId) };

          if (action === "delete") {
            const deleteResult = await classesCollection.deleteOne(filter);
            if (deleteResult.deletedCount === 1) {
              return res.status(200).send({
                success: true,
                message: "Class entry permanently removed.",
              });
            }
          } else {
            const targetStatus = action === "approve" ? "Approved" : "Pending";
            const updateResult = await classesCollection.updateOne(filter, {
              $set: { status: targetStatus },
            });

            if (updateResult.modifiedCount === 1) {
              return res.status(200).send({
                success: true,
                message: `Class state successfully adjusted to ${targetStatus}`,
              });
            }
          }

          res.status(404).send({
            success: false,
            message: "Class record not found or no alterations made.",
          });
        } catch (error) {
          console.error("Error managing class action execution:", error);
          res.status(500).send({
            success: false,
            message: "Internal server error reviewing classes.",
          });
        }
      },
    );

    // Get Pending and Rejected Trainer Validation Applications
    app.get(
      "/api/applied-trainers",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const query = {
            trainerApplication: { $in: ["pending", "rejected"] },
          };
          const options = {
            projection: {
              _id: 1,
              name: 1,
              email: 1,
              image: 1,
              role: 1,
              trainerApplication: 1,
              trainerApplicationDetails: 1,
            },
          };

          const applications = await usersCollection
            .find(query, options)
            .sort({ "trainerApplicationDetails.appliedAt": -1 })
            .toArray();

          res.status(200).send({
            success: true,
            count: applications.length,
            data: applications,
          });
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Internal server error" });
        }
      },
    );

    // Process Trainer Verification Applications (Approve / Reject & Demote)
    app.patch(
      "/api/applied-trainers/review",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { userId, action, feedback } = req.body;

          if (!userId || !["approve", "reject"].includes(action)) {
            return res.status(400).send({
              success: false,
              message:
                "Invalid payload parameters. Required: userId and action ('approve' or 'reject').",
            });
          }

          const filter = { _id: new ObjectId(userId) };
          let updateDoc = {};

          if (action === "approve") {
            updateDoc = {
              $set: {
                role: "trainer",
                trainerApplication: "approved",
                "trainerApplicationDetails.reviewedAt": new Date(),
              },
            };
          } else if (action === "reject") {
            updateDoc = {
              $set: {
                role: "user",
                trainerApplication: "rejected",
                "trainerApplicationDetails.feedback":
                  feedback || "No feedback provided.",
                "trainerApplicationDetails.reviewedAt": new Date(),
              },
            };
          }

          const result = await usersCollection.updateOne(filter, updateDoc);

          if (result.modifiedCount === 1) {
            res.status(200).send({
              success: true,
              message: `Application successfully processed with status: ${action}.`,
            });
          } else {
            res.status(404).send({
              success: false,
              message:
                "Target user application not found or status already set.",
            });
          }
        } catch (error) {
          console.error("Error updating trainer application status:", error);
          res.status(500).send({
            success: false,
            message:
              "Internal server error while processing approval state changes.",
          });
        }
      },
    );

    // Get Active Verified Instructors Directory List
    app.get("/api/trainers", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const query = { role: "trainer" };
        const options = {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            trainerApplicationDetails: 1,
          },
        };
        const trainers = await usersCollection.find(query, options).toArray();

        res
          .status(200)
          .send({ success: true, count: trainers.length, data: trainers });
      } catch (error) {
        console.error("Error retrieving trainers list:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching trainers directory.",
        });
      }
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
