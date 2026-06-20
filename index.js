const { MongoClient, ServerApiVersion } = require("mongodb");
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

    // Test API
    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
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

    app.get("/api/my-classes", async (req, res) => {
      const query = {};
      if (req.query.trainerId) {
        query.trainerId = req.query.trainerId;
      }
      const cursor = classesCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
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
