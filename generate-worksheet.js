// WorksheetGen API - Generates kid-friendly worksheets using Google Gemini

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      classLevel, subject, topic, length, language, teacherNotes
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured. Please add it in Vercel environment variables.'
      });
    }

    const prompt = buildPrompt({ classLevel, subject, topic, length, language, teacherNotes });

    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    };

    let response = null;
    let lastErrorText = '';
    let lastStatus = 0;

    for (const model of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          if (response.ok) break;
          lastStatus = response.status;
          lastErrorText = await response.text();
          if (response.status === 400 || response.status === 401 || response.status === 403) break;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
        } catch (fetchErr) {
          lastErrorText = fetchErr.message;
        }
      }
      if (response && response.ok) break;
    }

    if (!response || !response.ok) {
      let errorMessage = `Gemini API error: ${lastStatus || 'Unknown'}`;
      try {
        const errorData = JSON.parse(lastErrorText);
        if (errorData.error && errorData.error.message) errorMessage = errorData.error.message;
      } catch (e) {}
      if (lastStatus === 429) errorMessage = 'Rate limit reached. Please wait a minute.';
      else if (lastStatus === 503) errorMessage = 'AI servers are overloaded. Try again shortly.';
      return res.status(lastStatus || 500).json({ error: errorMessage });
    }

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) {
      throw new Error('Invalid response from Gemini API');
    }

    const generatedText = data.candidates[0].content.parts[0].text;
    let worksheet;
    try {
      worksheet = JSON.parse(generatedText);
    } catch (parseErr) {
      throw new Error('Failed to parse worksheet. Please try again.');
    }

    return res.status(200).json(worksheet);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error occurred' });
  }
};

function buildPrompt(config) {
  const cls = parseInt(config.classLevel);
  const isYoung = cls >= 1 && cls <= 3;
  const isMid = cls >= 4 && cls <= 5;
  const isOlder = cls >= 6 && cls <= 8;

  // Determine activity count based on length
  const lengthMap = {
    'short': { activities: 4, label: 'Short (1 page, 4 activities)' },
    'standard': { activities: 7, label: 'Standard (2 pages, 7 activities)' },
    'long': { activities: 10, label: 'Long (3 pages, 10 activities)' }
  };
  const lengthInfo = lengthMap[config.length] || lengthMap['standard'];

  const language = config.language || 'English';
  const languageNote = language === 'English' ? '' :
    language === 'Hinglish' ?
    `\n\nLANGUAGE: Mix Hindi (Devanagari) and English naturally — like Indian classrooms. Example: "Cat को Hindi में क्या कहते हैं?"` :
    `\n\nLANGUAGE: Generate ALL activity content in ${language}. Use proper script.`;

  // Available SVG icons (must match frontend library)
  const availableIcons = `
ANIMALS: cat, dog, cow, elephant, lion, tiger, bird, fish, butterfly, monkey, rabbit, frog, duck, pig
PLANTS & NATURE: tree, flower, leaf, sun, moon, star, cloud, rain, mountain
FOOD: apple, banana, mango, orange, grapes, milk, bread, cake, pizza, ice-cream
TRANSPORT: car, bus, train, bicycle, aeroplane, boat, scooter
OBJECTS: house, school, book, pen, pencil, chair, table, ball, bag, clock, umbrella
SHAPES: circle, square, triangle, rectangle, star, heart, oval, diamond
NUMBERS & MATH: number-1, number-2, number-3, number-4, number-5, number-6, number-7, number-8, number-9, number-10, plus, minus, equal, coin
PEOPLE: boy, girl, teacher, doctor, farmer, family
SPORTS: cricket-bat, football, badminton, kite
WEATHER: sunny, rainy, cloudy, windy
COLORS (text-only): red, blue, green, yellow, orange, purple, pink, brown, black, white
`;

  // Activity types appropriate for class level
  let activityTypes = '';
  if (isYoung) {
    activityTypes = `For Class 1-3 (young learners), use these activity types:
- "trace_letters" (trace alphabet/numbers)
- "count_pictures" (count visible icons)
- "match_pairs" (match icons to words/numbers)
- "color_picture" (description of what to color)
- "circle_correct" (circle correct answer from options)
- "fill_blank_simple" (very simple fill-in-the-blanks)
- "draw_picture" (instruction to draw something)`;
  } else if (isMid) {
    activityTypes = `For Class 4-5 (middle primary), use these activity types:
- "fill_blank" (fill in the blanks)
- "match_pairs" (match items in two columns)
- "true_false" (mark T or F)
- "circle_correct" (multiple choice)
- "short_answer" (1-2 sentence answer)
- "word_problem" (math word problems with Indian context)
- "label_diagram" (label parts of given image)
- "categorize" (group items by category)
- "rearrange" (rearrange letters/numbers/words)`;
  } else {
    activityTypes = `For Class 6-8 (upper primary), use these activity types:
- "fill_blank" (fill in the blanks)
- "match_pairs" (match items)
- "true_false" (true/false statements)
- "short_answer" (2-3 sentence answers)
- "long_answer" (paragraph answers)
- "word_problem" (real-world problems)
- "diagram_label" (label diagrams)
- "categorize" (classify items)
- "comprehension" (read passage and answer)
- "application" (apply concept to scenario)`;
  }

  return `You are an expert primary school teacher creating an engaging, age-appropriate worksheet for students.

============================
WORKSHEET CONTEXT
============================
- Class: ${config.classLevel}
- Subject: ${config.subject}
- Topic: ${config.topic}
- Length: ${lengthInfo.label}
- Total activities to generate: ${lengthInfo.activities}
${config.teacherNotes ? `- Teacher notes: ${config.teacherNotes}` : ''}${languageNote}

============================
AGE-APPROPRIATE GUIDELINES
============================

${isYoung ? `This is for YOUNG CHILDREN (Class ${config.classLevel}). They are 6-8 years old.
- Use VERY SIMPLE language (3-6 word instructions)
- LOTS of visual activities (counting, matching, coloring)
- Each activity should be FUN and DOABLE in 2-3 minutes
- Use friendly tone: "Let's count!", "Color the apple!", "Draw 3 stars"
- Avoid abstract concepts
- Use familiar objects (animals, fruits, toys)` : isMid ? `This is for MIDDLE PRIMARY (Class ${config.classLevel}). Children are 9-11 years old.
- Use clear, simple language but slightly more complex
- Mix visual and text-based activities
- Word problems with relatable Indian scenarios
- Each activity takes 3-5 minutes
- Build conceptual understanding
- Use Indian context (rupees, Indian names, festivals)` : `This is for UPPER PRIMARY (Class ${config.classLevel}). Children are 12-14 years old.
- More text-based activities with conceptual depth
- Real-world applications
- Critical thinking encouraged
- Each activity takes 4-7 minutes
- Use Indian context throughout`}

============================
INDIAN CONTEXT (MANDATORY)
============================

ALWAYS use Indian context in word problems and scenarios:
- Indian names: Riya, Arjun, Priya, Rohan, Meera, Aditya, Kavita, Rajesh, Sneha, Vikram, Ayesha
- Indian cities: Delhi, Mumbai, Bangalore, Chennai, Kolkata, Pune, Jaipur, Lucknow
- Indian currency (₹), measurements (km, kg)
- Indian scenarios: monsoon, Diwali, cricket, joint families, Indian markets

============================
AVAILABLE SVG ICONS
============================

You can ONLY reference these icons (use exact name in lowercase):
${availableIcons}

When you want to display icons in an activity, use the format: {icon: "apple", count: 5}
Example: To show 5 apples, use {icon: "apple", count: 5}

DO NOT invent icons not in the list. If unsure, use a related icon from the list or describe in text.

============================
ACTIVITY TYPES TO USE
============================

${activityTypes}

============================
WORKSHEET STRUCTURE
============================

Generate ${lengthInfo.activities} VARIED activities. Mix different activity types — don't use the same type for all activities. Make it engaging and fun!

============================
OUTPUT FORMAT — STRICT JSON
============================

Return ONLY valid JSON. No markdown, no backticks. Start with { and end with }.

Structure:

{
  "title": "Worksheet title (engaging, age-appropriate)",
  "metadata": {
    "subject": "${config.subject}",
    "class": "${config.classLevel}",
    "topic": "${config.topic}",
    "length": "${config.length}"
  },
  "header": {
    "greeting": "A friendly greeting/instruction for the student"
  },
  "activities": [
    {
      "number": 1,
      "type": "count_pictures",
      "title": "Count the apples",
      "instruction": "Count and write the number in the box.",
      "icons": [
        { "icon": "apple", "count": 3, "label": "= ___" },
        { "icon": "apple", "count": 5, "label": "= ___" },
        { "icon": "apple", "count": 7, "label": "= ___" }
      ]
    },
    {
      "number": 2,
      "type": "fill_blank",
      "title": "Fill in the blanks",
      "instruction": "Complete the following:",
      "questions": [
        { "text": "5 + 3 = ___", "answer": "8" },
        { "text": "10 - 4 = ___", "answer": "6" },
        { "text": "7 + 2 = ___", "answer": "9" }
      ]
    },
    {
      "number": 3,
      "type": "match_pairs",
      "title": "Match the columns",
      "instruction": "Draw a line to match the picture with the word.",
      "pairs": [
        { "left": { "type": "icon", "value": "elephant" }, "right": { "type": "text", "value": "Big animal" } },
        { "left": { "type": "icon", "value": "cat" }, "right": { "type": "text", "value": "Small pet" } },
        { "left": { "type": "icon", "value": "fish" }, "right": { "type": "text", "value": "Lives in water" } }
      ]
    },
    {
      "number": 4,
      "type": "circle_correct",
      "title": "Circle the correct answer",
      "instruction": "Circle the right option.",
      "questions": [
        {
          "text": "Which animal can fly?",
          "options": ["Cat", "Bird", "Fish", "Dog"],
          "answer": "Bird"
        }
      ]
    },
    {
      "number": 5,
      "type": "true_false",
      "title": "True or False",
      "instruction": "Write T for True and F for False.",
      "statements": [
        { "text": "The sun gives us light.", "answer": "T" },
        { "text": "Plants don't need water.", "answer": "F" }
      ]
    },
    {
      "number": 6,
      "type": "word_problem",
      "title": "Word Problem",
      "instruction": "Read carefully and solve.",
      "text": "Riya has 12 apples. She gives 4 apples to Arjun. How many apples does she have left?",
      "answer": "8 apples",
      "hint": "Hint: Use subtraction"
    },
    {
      "number": 7,
      "type": "color_picture",
      "title": "Color the picture",
      "instruction": "Color the apple red and the leaf green.",
      "icons": [
        { "icon": "apple", "count": 1, "size": "large" }
      ]
    },
    {
      "number": 8,
      "type": "short_answer",
      "title": "Write your answer",
      "instruction": "Answer in 1-2 sentences.",
      "questions": [
        { "text": "Name three things that grow on a tree.", "answer": "Mangoes, leaves, flowers" }
      ]
    },
    {
      "number": 9,
      "type": "categorize",
      "title": "Group the items",
      "instruction": "Write each item under the correct heading.",
      "categories": ["Living Things", "Non-living Things"],
      "items": ["Tree", "Rock", "Cat", "Pencil", "Bird", "Ball"]
    },
    {
      "number": 10,
      "type": "draw_picture",
      "title": "Draw and color",
      "instruction": "Draw a picture of your family in the box below."
    }
  ],
  "footer": {
    "encouragement": "Great job! ⭐",
    "selfAssessment": true
  }
}

============================
QUALITY CHECKLIST
============================

✓ Generated EXACTLY ${lengthInfo.activities} activities
✓ Mix of different activity types (don't repeat the same type)
✓ Age-appropriate language for Class ${config.classLevel}
✓ Indian context in word problems
✓ Only used icons from the available list
✓ Activities flow from easier → slightly harder
✓ Includes answer keys where applicable

Now generate the JSON output.`;
}
