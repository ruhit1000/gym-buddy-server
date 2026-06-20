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

    // All API for trainer
    // Classes API
    app.post("/api/classes", async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      if (result.insertedId) {
        res.status(201).send({ message: "Class created successfully" });
      } else {
        res.status(500).send({ message: "Failed to create class" });
      }
    });

    app.get("/api/classes/my-classes", async (req, res) => {
      const query = {};
      if (req.query.trainerId) {
        query.trainerId = req.query.trainerId;
      }
      const cursor = classesCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/api/classes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await classesCollection.deleteOne(query);
      if (result.deletedCount === 1) {
        res.send({ message: "Class deleted successfully" });
      } else {
        res.status(404).send({ message: "Class not found" });
      }
    });

    app.patch("/api/classes/:id", async (req, res) => {
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
