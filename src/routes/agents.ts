import { Router } from 'express';
import axios from 'axios';
//import { generateText } from 'ai';
//import { openai } from '@ai-sdk/openai';
import { MongoClient } from 'mongodb';
import * as cheerio from 'cheerio'; 
import openai from "openai";
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
const { window } = new JSDOM('');
const DOMParser = window.DOMParser;

const router = Router();
const Openai = new openai();

// Add this function before the router definition
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Function to fetch homepage HTML
const fetchHomepage = async (url: string) => {
  try {
    const response = await axios.get(url);
    return response.data; // HTML content
  } catch (error) {
    return `Failed to fetch homepage: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
};

// Function to all the pages from the url recursivley and only get the text 
export const crawlAndStore = async (startUrl: string) => {
    const visited = new Set<string>();
    const MAX_PAGES = 100;
    const mongoUri = process.env.MONGODB_URI;
    //console.log("MONGO_URI: ", mongoUri);
    if (!mongoUri) {
      throw new Error("MONGO_URI is not set");
    }else{
      console.log("MONGO_URI is set");
    }
  
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(); // database name inferred from URI
    const collection = db.collection('scraped_sites');
  
    const baseUrl = new URL(startUrl).origin;
    let fullText = '';
  
    const crawl = async (url: string) => {
      //console.log("Crawling: ", url, "Visited: ", visited.size);
      if (visited.size >= MAX_PAGES || visited.has(url)) return;
      visited.add(url);
  
      try {
        const res = await axios.get(url);
        const $ = cheerio.load(res.data);
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        fullText += `\n\n--- Page: ${url} ---\n${text}`;
  
        const links = $('a[href]')
          .map((_, el) => $(el).attr('href'))
          .get()
          .filter(href => href && (href.startsWith('/') || href.startsWith(baseUrl)))
          .map(href => (href.startsWith('http') ? href : `${baseUrl}${href}`));
  
        for (const link of links) {
          await crawl(link);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error(`Failed to fetch ${url}:`, err.message);
        } else {
          console.error(`Failed to fetch ${url}: Unknown error`, err);
        }
      }
    };
  
    await crawl(startUrl);
    return fullText.trim();
  };


async function getChatResponseSummary(homepage: string) {
const response = await Openai.chat.completions.create({
    model: 'gpt-4o-mini', // You can also use 'gpt-3.5-turbo' or other available models
    messages: [
    {
        role: 'system',
        content: 'You are a helpful assistant.',
    },
    {
        role: 'user',
        content: `Extract the Company Name , Type of Business / Industry following and Tagline or Value Proposition and products and servicesfrom the following HTML homepage content as a json object and only return the json object:\n\n${homepage}`,
    },
    ],
});
return response.choices[0].message.content;
};

async function getChatResponseQuestions(Summary: string, numberOfQuestions: number = 10) {
    const response = await Openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
        {
            role: 'system',
            content: 'You are a helpful assistant.',
        },
        {
            role: 'user',
            content: `generate a list of ${numberOfQuestions} questions that a customer would ask to a company like this , including basic questions like name, address, phone number, email, and return the questions as a json object and only return the json object:\n\n${Summary}`,
        },
        ],
    });
    return response.choices[0].message.content;
};

  async function getSystemPrompt(Summary: string) {
      const response = await Openai.chat.completions.create({
          model: 'gpt-4o-mini', // You can also use 'gpt-3.5-turbo' or other available models
          messages: [
          {
              role: 'system',
              content: 'You a AI assistant prompt generator.',
          },
          {
              role: 'user',
              content: `Generate a system prompt for a AI assistant with a cool name for a company like this add instructions to not hallucinate and only answer from the attached file and source:\n\n${Summary}`,
          },
          ],
      });
      return response.choices[0].message.content;
      };


async function parseQuestions(questions: string) {
        let parsedQuestions: string[] = [];

        try {
        // Extract JSON block from markdown-style response
        const jsonMatch = questions.match(/```json\s*({[\s\S]*?})\s*```/);
        const jsonString = jsonMatch ? jsonMatch[1] : questions;

        const parsed = JSON.parse(jsonString);
        parsedQuestions = parsed.questions || [];
        } catch (err) {
        console.error("Failed to parse questions JSON:", err);
        parsedQuestions = [questions]; // fallback
        }

          // // Now safely iterate
          // for (const question of parsedQuestions) {
          // console.log("--------------------------------");
          // console.log(question);
          // console.log("--------------------------------");
          // }
    return parsedQuestions;
    };

async function cleanUpAssistant(url: string) {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error("MONGO_URI is not set");
    }
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db();
    const collection = db.collection('scraped_sites');
    const result = await collection.findOne({ url: url });
    //console.log(result);
    if(result){
        const assistantId = result.assistantId;
        const fileId = result.fileId;
        const vectorStoreId = result.vectorStoreId;
        await Openai.beta.assistants.del(assistantId);
        await Openai.files.del(fileId);
        await Openai.vectorStores.del(vectorStoreId);
        await collection.deleteOne({ url: url });
    }
}


router.post('/cleanup', async (req, res) => {
    const { url } = req.body;
    await cleanUpAssistant(url);
    res.json({ message: 'Assistant cleaned up' });
});

// Create agent endpoint
router.post('/create', async (req, res) => {
    const { url } = req.body;
    console.log('starting to create agent for', url);
    //extract the domain from the url
    const domain = new URL(url).hostname;
    const baseDomain = domain.split('.').slice(-2, -1)[0]; // gets second-to-last part
   // console.log(baseDomain); 
    if (url && isValidUrl(url)) {
      //search for the url in the mongo db
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error("MONGO_URI is not set");
      }
      const client = new MongoClient(mongoUri);
      await client.connect();
      const db = client.db();
      const collection = db.collection('scraped_sites');
      const result = await collection.findOne({ url: url });
      //console.log(result);
      let homepage = '';
      let content = '';
      let summary = '';
      let questions = '';
      //fetch the homepage
      if(!result){
        homepage = await fetchHomepage(url);
        const summaryResult = await getChatResponseSummary(homepage);
        if (!summaryResult) {
            throw new Error('Failed to get summary');
        }
        summary = summaryResult;
        let numberOfQuestions = 25;
        const questionsResult = await getChatResponseQuestions(summary,numberOfQuestions);
        questions = questionsResult || '';
        //console.log(questions);
        content = await crawlAndStore(url);
        await collection.updateOne(
          { url },
          {
          $set: {
              summary,
              questions,
              content,
              crawledAt: new Date(),
          },
          },
          { upsert: true }
        );
      }else{
          homepage = result.content;
          summary = result.summary;   
          questions = result.questions;
          content = result.content;
      }

      const file = await Openai.files.create({
        file: new File([content || ''], `${baseDomain}.txt`, { type: 'text/plain' }),
        purpose: 'assistants',
      });
      //console.log('Uploaded file ID:', file.id);   

      const vectorStore = await Openai.vectorStores.create({
        name: `${baseDomain}`,
        file_ids: [file.id], // Replace with your actual file IDs
      });
      //console.log('Vector store created:', vectorStore);
      const systemPrompt = await getSystemPrompt(summary);
      const assistant = await Openai.beta.assistants.create({
        name: `${baseDomain}`,
        instructions: systemPrompt,
        model: 'gpt-4o-mini',
        tools: [{ type: 'file_search' }],
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStore.id],
          },
        },
      });
      //console.log('Assistant created:', assistant);

      //console.log(questions);
      const parsedQuestions = await parseQuestions(questions || '');
      const thread = await Openai.beta.threads.create();
      const threadId = thread.id;
      const assistantId = assistant.id;
      let transcript = '';
      //print the question number and question
      console.log(parsedQuestions);
      let questionNumber = 1;     

      for (const question of parsedQuestions) {
        console.log(`${questionNumber}. ${question}`);
        questionNumber++;
        await Openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: question,
        });
      
        // 2. Start assistant run
        const run = await Openai.beta.threads.runs.create(threadId, {
            assistant_id: assistantId,
        });
          
        //console.log(`Run started for question: "${question}" => Run ID: ${run.id}`);
        
        // 3. Poll for completion
        let status = run.status;
        let runResult = run;
        while (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            runResult = await Openai.beta.threads.runs.retrieve(threadId, run.id);
            status = runResult.status;
            console.log(status);
        }
          
        // 4. Get assistant's reply
        const messages = await Openai.beta.threads.messages.list(threadId);
        const last = messages.data.find((m) => m.role === 'assistant');
        const content = last?.content[0];
        const response = content && 'text' in content ? content.text.value : 'No response';
        console.log(`💬 Assistant: ${response}`);
        transcript += `Q: ${question}\nA: ${response}\n\n`;
        }

        await collection.updateOne(
            { url }, // or another selector
            { $set: { Q_A: transcript,
                      assistantId: assistantId,
                      fileId: file.id,
                      vectorStoreId: vectorStore.id,
                      crawledAt: new Date(),
                    } 
            },
            { upsert: true }
          );

        res.json({  
          message: `Hi, found URL: ${url}`,
        });
    } else {
      res.json({ message: 'Invalid URL or no URL provided' });
    }
  });

function injectLineBreaks(raw: string): string {
return raw
    // Ensure line breaks before numbered items (e.g., "1." not part of previous sentence)
    .replace(/(\d+)\.\s*/g, '\n$1. ') // places line break before each numbered item
    .replace(/(Phone:\s*[^\s]+)/g, '\n$1') // line break before Phone:
    .replace(/(\*\*[^:]+:\*\*)/g, '\n$1')  // line break before **Country:**
    .replace(/【.*?】/g, '')               // strip citation tags
    .replace(/\s{2,}/g, ' ')              // collapse double+ spaces
    .replace(/\n{2,}/g, '\n')             // collapse double+ newlines
    .trim();
}

async function markdownToTextRuns(markdown: string): Promise<TextRun[]> {
    const html = await marked.parseInline(markdown);
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const spans = dom.body.childNodes;
    const runs: TextRun[] = [];
  
    spans.forEach((node: any) => {
      if (node.nodeType === 3) {
        runs.push(new TextRun(node.textContent || ''));
      } else if (node.nodeName === 'STRONG') {
        runs.push(new TextRun({ text: node.textContent || '', bold: true }));
      } else if (node.nodeName === 'EM') {
        runs.push(new TextRun({ text: node.textContent || '', italics: true }));
      } else {
        runs.push(new TextRun(node.textContent || ''));
      }
    });
  
    return runs;
  }

async function formatQAPlainText(rawText: string): Promise<{ paragraphs: Paragraph[] }> {
    const qaRegex = /Q:\s*(.*?)\nA:\s*((?:.(?!\nQ:))*.)/gs;
    const paragraphs: Paragraph[] = [];
  
    let match;
    while ((match = qaRegex.exec(rawText)) !== null) {
      const question = match[1].trim();
      const answer = match[2].trim();
  
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Q: ${question}`, bold: true })],
          spacing: { after: 100 },
        })
      );
  
      const prettifiedAnswer = injectLineBreaks(answer);
      const lines = prettifiedAnswer.split('\n').map(l => l.trim()).filter(Boolean);
  
      const isNumbered = lines.every(line => /^\d+\.\s/.test(line));
  
      if (isNumbered) {
        for (const line of lines) {
          const cleanText = line.replace(/^\d+\.\s*/, '');
          paragraphs.push(
            new Paragraph({
              children: await markdownToTextRuns(cleanText),
              numbering: {
                reference: 'numbered-list',
                level: 0,
              },
            })
          );
        }
      } else {
        for (const line of lines) {
          const runs = await markdownToTextRuns(line);
          paragraphs.push(new Paragraph({ children: runs, spacing: { after: 100 } }));
        }
      }
  
      paragraphs.push(new Paragraph({ spacing: { after: 300 } }));
    }
  
    return { paragraphs };
  }


router.post('/createdoc', async (req, res) => {
    const { url } = req.body;
    console.log(url);
  
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ message: 'Invalid or missing URL' });
    }
  
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not set");
  
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db();
    const collection = db.collection('scraped_sites');
    const result = await collection.findOne({ url });
  
    if (!result) return res.status(404).json({ message: 'No data found for this URL' });
  
    const { summary, questions, content, Q_A } = result;
    const qaBlocks = await formatQAPlainText(Q_A || '');
  
    const doc = new Document({
        numbering: {
          config: [
            {
              reference: 'numbered-list',
              levels: [
                {
                  level: 0,
                  format: 'decimal',
                  text: '%1.',
                  alignment: 'left',
                },
              ],
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Q&A', bold: true, size: 28 })],
                spacing: { after: 200 },
              }),
              ...qaBlocks.paragraphs, // from formatQAPlainText()
              new Paragraph({
                children: [new TextRun({ text: 'Full Content', bold: true, size: 28 })],
                pageBreakBefore: true,
              }),
              new Paragraph({ children: [new TextRun(content)] }),
            ],
          },
        ],
      });
  
    const buffer = await Packer.toBuffer(doc);
  
    res.setHeader('Content-Disposition', `attachment; filename=JediTeck_QA_${Date.now()}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);
  });

router.post('/countassistantsdev', async (req, res) => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not set");
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db();
    const collection = db.collection('assistants');
    const result = await collection.find({}).toArray();
    console.log(result.length);
    for (const assistant of result) {
      console.log(assistant.name, assistant.created, assistant.userEmail,assistant.assistantId,assistant.createdAt);
      const cleaned = await cleanUpAssistantwithid(assistant);
      if(cleaned){
        await collection.deleteOne({ assistantId: assistant.assistantId });
      }
    }
    res.json({ message: 'Count of assistants: ' + result.length });

  });

async function cleanUpAssistantwithid(assistant: any) {
  try{
    const assistantId = assistant.assistantId;
    const fileId = assistant.fileId;
    const vectorStoreId = assistant.vectorStoreId;
    await Openai.beta.assistants.del(assistantId);
    await Openai.files.del(fileId);
    await Openai.vectorStores.del(vectorStoreId);
    console.log('Cleaned up assistant: ', assistantId);
    return true;
  }catch(error){
    console.error('Error cleaning up assistant: ', error)
    return false;
  }
}

router.post('/cleanuporphans', async (req, res) => {
  try {
    const orphanedFileIds = new Set<string>();
    const usedFileIds = new Set<string>();

    // 1. Get all assistants and their linked vector store IDs
    const assistants = await Openai.beta.assistants.list();
    const activeVectorStoreIds = new Set(
      assistants.data.flatMap(a =>
        a.tool_resources?.file_search?.vector_store_ids || []
      )
    );

    // 2. Get all vector stores
    const vectorStores = await Openai.vectorStores.list();

    for (const vs of vectorStores.data) {
      const vsId = vs.id;

      if (!activeVectorStoreIds.has(vsId)) {
        // Orphaned vector store: collect its files and delete it
        const files = await Openai.vectorStores.files.list(vsId);
        files.data.forEach(file => orphanedFileIds.add(file.id));

        await Openai.vectorStores.del(vsId);
        console.log(`🗑️ Deleted orphaned vector store: ${vsId}`);
      } else {
        // Still in use: track its files
        const files = await Openai.vectorStores.files.list(vsId);
        files.data.forEach(file => usedFileIds.add(file.id));
      }
    }

    // 3. Get all files
    const allFiles = await Openai.files.list();

    // 4. Delete files that were in orphaned vector stores but aren't used anywhere else
    for (const file of allFiles.data) {
      if (!usedFileIds.has(file.id) && orphanedFileIds.has(file.id)) {
        await Openai.files.del(file.id);
        console.log(`🗑️ Deleted orphaned file: ${file.id}`);
      }
    }

    res.json({ message: '✅ Cleanup complete.' });
  } catch (error: any) {
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({ error: 'Cleanup failed', details: error?.message });
  }
});

router.post('/cleanup/assistants/from-mongo-devenv', async (req, res) => {
  const deleted = [];

  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI is not set");
    const client = await MongoClient.connect(mongoUri);
    const db = client.db(); // default DB
    const assistantsCollection = db.collection('assistants');

    const assistants = await assistantsCollection.find({}).toArray();

    for (const record of assistants) {
      const assistantId = record.assistantId;
      if (!assistantId) continue;

      try {
        // Fetch assistant details from OpenAI
        const assistant = await Openai.beta.assistants.retrieve(assistantId);

        // Delete assistant
        await Openai.beta.assistants.del(assistantId);
        console.log(`🗑️ Deleted assistant: ${assistantId}`);

        const vectorStoreIds = assistant.tool_resources?.file_search?.vector_store_ids || [];

        for (const vsId of vectorStoreIds) {
          try {
            const files = await Openai.vectorStores.files.list(vsId);
            await Openai.vectorStores.del(vsId);
            console.log(`🗑️ Deleted vector store: ${vsId}`);

            for (const file of files.data) {
              try {
                await Openai.files.del(file.id);
                console.log(`🗑️ Deleted file: ${file.id}`);
              } catch (err: unknown) {
                console.warn(`⚠️ Failed to delete file ${file.id}:`, err instanceof Error ? err.message : 'Unknown error');
              }
            }
          } catch (err: unknown) {
            console.warn(`⚠️ Failed to delete vector store ${vsId}:`, err instanceof Error ? err.message : 'Unknown error');
          }
        }

        deleted.push(assistantId);

      } catch (err: unknown) {
        console.warn(`⚠️ Failed to delete assistant ${assistantId}:`, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    await client.close();
    res.json({ message: '✅ Cleanup complete', deletedAssistants: deleted });
  } catch (error: unknown) {
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({ error: 'Cleanup failed', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
