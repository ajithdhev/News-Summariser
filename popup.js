// Summarization function using an API
async function summarizeWithAI(text, maxRetries = 2) {
    const prompt = `You will be provided with a news article. Create a clear and concise 5-point summary focusing on the key facts and developments.

Article:
${text}

Instructions: Write exactly 5 numbered points, each capturing an important fact or development from the article and each point should be under 20 words. Be specific and factual.

Summary:`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(CONFIG.TOGETHER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.TOGETHER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: CONFIG.MODEL,
                    prompt: prompt,
                    max_tokens: 1024,
                    temperature: 0.3,
                    top_p: 0.8,
                    top_k: 50,
                    repetition_penalty: 1.1
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.log('API Error:', error);
                throw new Error(error.message || 'API request failed');
            }

            const data = await response.json();
            console.log('Raw API Response:', data);

            if (!data.output) {
                if (attempt < maxRetries) {
                    console.log(`Attempt ${attempt + 1} failed, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                throw new Error('Invalid API response structure');
            }

            let summary = "";
            if (data.output.choices && data.output.choices.length > 0) {
                summary = data.output.choices[0].text || data.output.choices[0];
            } else {
                throw new Error('No summary text found in API response');
            }
            console.log('Raw summary:', summary);

            if (typeof summary !== 'string') {
                throw new Error('Summary is not a string');
            }

            summary = summary.trim();            
            console.log('Cleaned summary:', summary);

            if (summary.length < 10) {
                if (attempt < maxRetries) {
                    console.log('Summary too short, retrying...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                throw new Error('Generated summary too short');
            }

            let points = summary
                .split('\n')
                .filter(line => /^\d+[\.)]\s/.test(line))
                .map(line => line.replace(/^\d+[\.)]\s*/, '').trim());

            if (points.length >= 5) {
                return points.slice(0, 5);
            }

            if (attempt < maxRetries) {
                console.log('No proper points found, retrying...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            throw new Error('Could not generate proper summary');
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            console.log(`Error on attempt ${attempt + 1}:`, error);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Updated function to extract article content using multiple heuristics
async function getArticleContent() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
            // Extraction function that applies several heuristics
            function extractMainArticleContent() {
                let content = "";
                
                // 1. Try <article> tag first.
                const articleTag = document.querySelector("article");
                if (articleTag && articleTag.innerText.trim().length > 200) {
                    content = articleTag.innerText.trim();
                }
                
                // 2. Try common selectors if no sufficient content found.
                if (!content || content.length < 200) {
                    const selectors = [
                        'div[itemprop="articleBody"]',
                        'div[class*="article-body"]',
                        'div[class*="story-body"]',
                        'section[class*="article"]',
                        'div[data-testid^="paragraph-"]', 
                        'div[class*="post-content"]'
                    ];
                    let bestText = "";
                    selectors.forEach(sel => {
                        const el = document.querySelector(sel);
                        if (el) {
                            const txt = el.innerText.trim();
                            if (txt.length > bestText.length) {
                                bestText = txt;
                            }
                        }
                    });
                    content = bestText;
                }
                
                // 3. Final fallback: combine text from all <p> elements outside boilerplate.
                if (!content || content.length < 200) {
                    const paragraphs = document.querySelectorAll("p");
                    let combined = "";
                    paragraphs.forEach(p => {
                        if (!p.closest("header, footer, nav, aside")) {
                            combined += p.innerText.trim() + "\n\n";
                        }
                    });
                    content = combined.trim();
                }
                return content;
            }
            return extractMainArticleContent();
        }
    });
    
    return results[0].result;
}

// Main initialization function
async function init() {
    const loadingDiv = document.getElementById('loading');
    const summaryDiv = document.getElementById('summary');
    const errorDiv = document.getElementById('error');

    try {
        const content = await getArticleContent();
        if (!content) {
            throw new Error('Could not find article content on this page');
        }

        let currentAttempt = 1;
        const updateLoadingMessage = () => {
            loadingDiv.innerHTML = `
                <div class="loading-spinner"></div>
                <div>Analyzing with AI...<br>Attempt ${currentAttempt}/3</div>
            `;
        };
        updateLoadingMessage();

        const summaryPoints = await summarizeWithAI(content);
        
        loadingDiv.style.display = 'none';
        summaryDiv.innerHTML = summaryPoints
            .map((point, index) => `
                <div class="bullet-point">
                    <span class="bullet-number">${index + 1}.</span>
                    ${point}
                </div>
            `)
            .join('');
    } catch (error) {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = error.message;
        console.error('Error:', error);
    }
}

document.addEventListener('DOMContentLoaded', init);
