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

    // ==========================================
    // 1. PUBLIC API ROUTES
    // ==========================================
    app.get("/", (req, res) => {
      res.send("Hello World!");
    });

    // Get Approved Classes Catalog Catalog (With Search, Filter, Pagination)
    app.get("/api/classes", async (req, res) => {
      try {
        const { search, category, page = 1, limit = 15 } = req.query;
        const query = { status: "Approved" };

        if (search && search.trim() !== "") {
          query.className = { $regex: search.trim(), $options: "i" };
        }

        if (category && category.trim() !== "") {
          const categoryArray = category.split(",").map((cat) => cat.trim());
          query.category = { $in: categoryArray };
        }

        const pageNumber = parseInt(page, 10);
        const limitNumber = parseInt(limit, 10);
        const skipOffset = (pageNumber - 1) * limitNumber;

        const [classes, totalCount] = await Promise.all([
          classesCollection
            .find(query)
            .skip(skipOffset)
            .limit(limitNumber)
            .toArray(),
          classesCollection.countDocuments(query),
        ]);

        const totalPages = Math.ceil(totalCount / limitNumber);

        res.send({
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

    // Get Unique List of Available Categories
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

        res.send({
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

    // ==========================================
    // 2. TRAINER & PROTECTED MANIPULATION ROUTES
    // ==========================================

    // Create New Class Entry
    app.post("/api/classes", verifyToken, verifyTrainer, async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      if (result.insertedId) {
        res.status(201).send({ message: "Class created successfully" });
      } else {
        res.status(500).send({ message: "Failed to create class" });
      }
    });

    // Get Logged In Trainer's Specific Classes (CRITICAL: Static routes placed ABOVE dynamic dynamic paths)
    app.get("/api/classes/my-classes", verifyToken, async (req, res) => {
      try {
        const user = req.user;

        const query = {
          trainerId: user._id.toString(),
        };

        const result = await classesCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        console.error("Error retrieving trainer classes:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal Server Error" });
      }
    });

    // Delete Targeted Class Entry
    app.delete("/api/classes/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.deleteOne(query);
      if (result.deletedCount === 1) {
        res.send({ message: "Class deleted successfully" });
      } else {
        res.status(404).send({ message: "Class not found" });
      }
    });

    // Partial Edit Update Class Meta Property Attributes
    app.patch("/api/classes/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const updatedClass = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: updatedClass,
      };
      const result = await classesCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount === 1) {
        res.send({ success: true, message: "Class updated successfully" });
      } else {
        res.status(404).send({ success: false, message: "Class not found" });
      }
    });

    // Fetch Details for a Single Specific Class
    app.get("/api/classes/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.findOne(query);
      if (result) {
        res.status(200).send({ success: true, data: result });
      } else {
        res.status(404).send({ message: "Class not found" });
      }
    });

    // ==========================================
    // 3. SECURED USER REACTION/FAVORITES ROUTES
    // ==========================================

    // Toggle Favorite Action (Add or Remove)
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
          return res.send({
            success: true,
            isFavorited: false,
            message: "Removed from favorites successfully.",
          });
        }

        const newFavoriteDoc = {
          ...query,
          createdAt: new Date(),
        };

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

    // Verify If Class Exists On Target User's List
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
        const isFavorited = count > 0;

        res.send({
          success: true,
          isFavorited,
        });
      } catch (error) {
        console.error("Error verifying class favorite criteria state:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while checking favorite status.",
        });
      }
    });

    app.get("/api/favorites/my-favorites", verifyToken, async (req, res) => {
      try {
        const user = req.user;

        const pipeline = [
          {
            $match: {
              userId: new ObjectId(user._id),
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "classId",
              foreignField: "_id",
              as: "classDetails",
            },
          },
          {
            $unwind: "$classDetails",
          },
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
        res.send(result);
      } catch (error) {
        console.error("Error retrieving my favorites via aggregation:", error);
        res.status(500).send({
          success: false,
          message:
            "Internal server error while retrieving aggregated favorites.",
        });
      }
    });

    app.post("/api/users/apply-trainer", verifyToken, async (req, res) => {
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
    });

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

        res.status(200).send({
          success: true,
          data: user,
        });
      } catch (error) {
        console.error("Error retrieving user profile information:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching user profile data.",
        });
      }
    });

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

        res.status(200).send({
          success: true,
          count: trainers.length,
          data: trainers,
        });
      } catch (error) {
        console.error("Error retrieving trainers list:", error);
        res.status(500).send({
          success: false,
          message: "Internal server error while fetching trainers directory.",
        });
      }
    });

    // 1. GET ALL USERS (For rendering the data table)
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
        // Fetch all records, fallback to "active" status if undefined in DB
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

    // 2. PATCH USER STATUS (Block / Unblock / Make Admin)
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
