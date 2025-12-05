const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

// Initialize Gemini lazily
let genAI = null;

async function identifyItem(imageInput, isUrl = false) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  if (!genAI) {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  try {
    // Updated to latest stable model (Nov 2025)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let imagePart;
    
    if (isUrl) {
      // For URLs, we'd need to fetch it first. 
      // For simplicity in this iteration, we assume the frontend sends base64 or a file.
      // If imageInput is a fetch-able URL, we fetch it to a buffer.
      const response = await fetch(imageInput);
      const arrayBuffer = await response.arrayBuffer();
      imagePart = {
        inlineData: {
          data: Buffer.from(arrayBuffer).toString("base64"),
          mimeType: "image/jpeg", // Naive assumption, usually fine for Gemini
        },
      };
    } else {
      // Handle both Multer object (has .buffer) and raw Node Buffer
      const buffer = imageInput.buffer || imageInput;
      const mimeType = imageInput.mimetype || "image/jpeg"; // Default to jpeg for raw buffers

      imagePart = {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: mimeType,
        },
      };
    }

    const prompt = `
      You are an expert reseller and appraiser.
      Analyze this image and identify the specific product Make and Model for an eBay search.
      
      Return ONLY a valid JSON object with this structure:
      {
        "searchTerm": "Specific Model Name", 
        "confidence": "high" | "medium" | "low",
        "reasoning": "Brief explanation"
      }

      Rules:
      1. Be specific (e.g. "Sony WH-1000XM4" instead of "Sony Headphones").
      2. If you cannot clearly identify the model, set "searchTerm" to null.
      3. Do not include generic terms like "black" or "used" unless part of the model name.
    `;

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    // Clean up markdown if Gemini returns it
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(cleanJson);

  } catch (error) {
    console.error("Gemini Identify Error:", error);
    throw new Error("Failed to identify item: " + error.message);
  }
}

module.exports = { identifyItem };
