const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("gym-buddy");
    const usersCollection = database.collection("user");
    const classesCollection = database.collection("classes");
    const favoritesCollection = database.collection("favorites");
    const sessionCollection = database.collection("session");

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

    // All Public API
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

    // All API for logged in user
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

    // All API for trainer
    // Classes API
    app.post("/api/classes", verifyToken, verifyTrainer, async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      if (result.insertedId) {
        res.status(201).send({ message: "Class created successfully" });
      } else {
        res.status(500).send({ message: "Failed to create class" });
      }
    });

    app.get(
      "/api/classes/my-classes",
      verifyToken,
      verifyTrainer,
      async (req, res) => {
        const query = {};
        if (req.query.trainerId) {
          query.trainerId = req.query.trainerId;
        }
        const cursor = classesCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      },
    );

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

    // All API for user
    // Favorites API
    app.post("/api/favorites/toggle", verifyToken, async (req, res) => {
      try {
        const { userId, classId } = req.body;

        if (!userId || !classId) {
          return res.status(400).send({
            success: false,
            message: "Missing required fields: userId and classId",
          });
        }

        const query = {
          userId: new ObjectId(userId),
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

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
