/**
 * client.js - JavaScript logic for the AI-powered form filling
 * Integrates with /api/chat endpoint for robust backend processing
 */

// Session management - track thread across requests
let sessionThreadId = null;

// Local conversation history (fallback for Redis failures)
let localConversationHistory = [];

// UUID generator function
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');            
    
    // Initialize FormCapture with custom configuration
    if (typeof FormCapture !== 'undefined') {
        FormCapture.init({
            captureOnLoad: true,
            captureOnChange: true,
            onCapture: function(formsData) {
                // We get an array of form data, get the first one since we only have one form
                const formData = formsData[0];
                
                // Capture simplified data using the new feature
                const simplifiedData = FormCapture.extractSimplifiedFields(formsData);
                
                // Log both full and simplified data to console
                console.log('Simplified Data (data-id fields only):', simplifiedData);
                
                // Display captured data in the output div
                const outputElement = document.getElementById('outputData');
                if (outputElement) {
                    outputElement.textContent = JSON.stringify({
                        fullData: formData,
                        simplifiedData: simplifiedData
                    }, null, 2);
                }
                
                // Display simplified data separately if element exists
                const simplifiedOutputElement = document.getElementById('simplifiedOutputData');
                if (simplifiedOutputElement) {
                    simplifiedOutputElement.textContent = JSON.stringify(simplifiedData, null, 2);
                }
            }
        });
        
        // Log the initial simplified data on load
        setTimeout(() => {
            const initialSimplifiedData = captureSimplifiedData();
            //console.log('Initial Simplified Data on Load:', initialSimplifiedData);
        }, 500);
    }
    
    // Add event listeners to form fields
    function setupFieldListeners() {
        const aiAgentSendButton = document.getElementById('ai-agent-send');
        console.log(aiAgentSendButton);
        if (aiAgentSendButton) {
            aiAgentSendButton.addEventListener('click', function(event) {
                event.preventDefault(); // Prevent default button behavior
                console.log('AI Agent Send button clicked');
                
                // Send form data to API when AI Agent button is pressed
                sendSimplifiedDataOnly();
                
                // Log simplified data on input (with throttling to avoid spam)
                if (typeof captureSimplifiedData !== 'undefined') {
                    clearTimeout(aiAgentSendButton.inputTimeout);
                    aiAgentSendButton.inputTimeout = setTimeout(() => {
                        const simplifiedData = captureSimplifiedData();
                        //console.log('Real-time Simplified Data:', simplifiedData);
                    }, 500); // Throttle to 500ms
                }
            });
        }
    }

    // Function to send only simplified data (lightweight version)
    function sendSimplifiedDataOnly() {
        // Get simplified data using the new FormCapture feature
        let simplifiedData = [];
        if (typeof captureSimplifiedData !== 'undefined') {
            simplifiedData = captureSimplifiedData();
            console.log('Sending Simplified Data Only:', simplifiedData);
        }
        
        // Update response message element if it exists
        const responseMessage = document.getElementById("responseMessage");
        if (responseMessage) {
            responseMessage.innerText = "Sending simplified data...";
        }
        
        // Get AI Agent input message
        let aiMessage = '';
        const aiAgentSendButton = document.getElementById('ai-agent-send');
        if (aiAgentSendButton) {
            const aiAgentInput = aiAgentSendButton.previousElementSibling;
            if (aiAgentInput && aiAgentInput.tagName === 'INPUT') {
                aiMessage = aiAgentInput.value || '';
                console.log('AI Agent Input Value:', aiMessage);
            } else {
                // Alternative method: look for input in the same container
                const inputArea = aiAgentSendButton.closest('.input-area');
                if (inputArea) {
                    const textInput = inputArea.querySelector('input[type="text"]');
                    if (textInput) {
                        aiMessage = textInput.value || '';
                        console.log('AI Agent Input Value:', aiMessage);
                    }
                }
            }
        }
        
        // Transform simplified data to FormField format for ChatRequest
        const formFields = simplifiedData.map(field => ({
            id: field['data-id'],
            label: field.fieldLabel,
            type: field.fieldType,
            required: field.fieldType !== 'hidden',
            value: field.fieldValue || null
        }));
        
        // Create ChatRequest payload
        const payload = {
            session: {
                threadId: sessionThreadId || generateUUID(),
                applicant: {},
                metadata: {
                    source: 'FormCapture.js',
                    pageUrl: window.location.href
                }
            },
            page: {
                id: document.querySelector('form')?.id || 'form-1',
                title: document.querySelector('form')?.getAttribute('data-title') || 'Form',
                fields: formFields
            },
            fields: formFields.map(f => ({
                id: f.id,
                value: f.value
            })),
            history: localConversationHistory,  // Send as fallback for Redis failures
            user_message: aiMessage
        };
        
        console.log('ChatRequest Payload:', payload);
        
        // Update the div with class 'message user' to show what user typed
        const userMessageDiv = document.querySelector('.message.user');
        if (userMessageDiv) {
            let userFormattedMessage = '';
            
            // Add user's message if provided
            if (aiMessage) {
                userFormattedMessage += `💬 ${aiMessage}\n\n`;
            }
            
            // Add form fields information
            if (formFields && formFields.length > 0) {
                userFormattedMessage += `📋 Form Data (${formFields.length} fields):\n`;
                formFields.forEach((field, index) => {
                    userFormattedMessage += `\n${index + 1}. ${field.id || 'Unknown Field'}\n`;
                    if (field.label) {
                        userFormattedMessage += `   Label: ${field.label}\n`;
                    }
                    userFormattedMessage += `   Type: ${field.type}\n`;
                    if (field.value) {
                        userFormattedMessage += `   Value: ${field.value}\n`;
                    } else {
                        userFormattedMessage += `   Value: (empty)\n`;
                    }
                });
            } else {
                userFormattedMessage += `📋 No form fields with data-id attributes found`;
            }
            
            // Set the formatted text with proper line breaks
            userMessageDiv.style.whiteSpace = 'pre-wrap';
            userMessageDiv.textContent = userFormattedMessage || 'No message or form data provided';
            
            console.log('💬 Updated user message div with message and form fields:', {
                message: aiMessage,
                formFieldsCount: formFields.length
            });
        } else {
            console.warn('⚠️ User message div (.message.user) not found in DOM');
        }
        
        // Send request to /api/chat endpoint (Azure deployed backend)
        fetch(`https://water-permit-api-poonam.azurewebsites.net/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                // Handle HTTP error responses
                return response.json().then(errorData => {
                    throw errorData;
                });
            }
            return response.json();
        })
        .then(data => {
            // ChatResponse received
            console.log('ChatResponse:', data);
            
            // Update session thread ID for continuity
            if (data.threadId) {
                sessionThreadId = data.threadId;
                console.log('Session Thread ID updated:', sessionThreadId);
            }
            
            // Update local conversation history cache (fallback for Redis failures)
            if (data.conversationHistory && Array.isArray(data.conversationHistory)) {
                localConversationHistory = data.conversationHistory;
                console.log(`Local history updated: ${localConversationHistory.length} messages cached`);
            }
            
            if (responseMessage) {
                responseMessage.innerText = "Success: Response received";
            }
            
            // Update the div with class 'message bot' with the response
            const botMessageDiv = document.querySelector('.message.bot');
            if (botMessageDiv) {
                // Create nicely formatted response text
                let formattedResponse = '';
                
                // Show bot's message
                if (data.responseMessage) {
                    formattedResponse += `🤖 ${data.responseMessage}\n\n`;
                }
                
                // Show status
                if (data.status) {
                    const statusEmoji = data.status === 'completed' ? '✅' : 
                                       data.status === 'awaiting_info' ? '⏳' :
                                       data.status === 'error' ? '❌' : '🔄';
                    formattedResponse += `${statusEmoji} Status: ${data.status}\n\n`;
                }
                
                // Show filled fields
                if (data.filledFields && data.filledFields.length > 0) {
                    formattedResponse += `✅ Extracted Fields (${data.filledFields.length}):\n`;
                    data.filledFields.forEach((field, index) => {
                        formattedResponse += `${index + 1}. ${field.id}: ${field.value}\n`;
                        if (field.confidence !== undefined) {
                            formattedResponse += `   Confidence: ${(field.confidence * 100).toFixed(0)}%\n`;
                        }
                    });
                    formattedResponse += '\n';
                }
                
                // Show missing fields
                if (data.missingFields && data.missingFields.length > 0) {
                    formattedResponse += `⚠️ Missing Required Fields (${data.missingFields.length}):\n`;
                    data.missingFields.forEach((field, index) => {
                        formattedResponse += `${index + 1}. ${field.id}`;
                        if (field.label) {
                            formattedResponse += ` (${field.label})`;
                        }
                        formattedResponse += '\n';
                    });
                    formattedResponse += '\n';
                }
                
                // Show validation errors if any
                if (data.validationErrors && data.validationErrors.length > 0) {
                    formattedResponse += `❌ Validation Errors:\n`;
                    data.validationErrors.forEach((error, index) => {
                        formattedResponse += `${index + 1}. ${error}\n`;
                    });
                    formattedResponse += '\n';
                }
                
                // Show current field being asked about
                if (data.currentField) {
                    formattedResponse += `📝 Current Field: ${data.currentField}\n\n`;
                }
                
                // Show thread ID for reference
                if (data.threadId) {
                    formattedResponse += `🔗 Session ID: ${data.threadId}\n`;
                }
                
                // Set the formatted text
                botMessageDiv.style.whiteSpace = 'pre-wrap';
                botMessageDiv.textContent = formattedResponse || 'Response received successfully';
                
                console.log('🤖 Updated bot message div with ChatResponse:', data);
            } else {
                console.warn('⚠️ Bot message div (.message.bot) not found in DOM');
            }
        })
        .catch(error => {
            console.error("Error:", error);
            
            // Update the div with class 'message bot' with error information
            const botMessageDiv = document.querySelector('.message.bot');
            if (botMessageDiv) {
                let errorMessage = '❌ Error occurred while processing your request:\n\n';
                
                // Handle ChatResponse error format
                if (error.error) {
                    errorMessage += `💬 ${error.error}\n`;
                    if (error.errorCode) {
                        errorMessage += `📋 Error Code: ${error.errorCode}\n`;
                    }
                }
                // Check if it's a validation error with detail array
                else if (error.detail && Array.isArray(error.detail)) {
                    errorMessage += '🔍 Validation Errors:\n';
                    error.detail.forEach((validationError, index) => {
                        errorMessage += `\n${index + 1}. `;
                        if (validationError.msg) {
                            errorMessage += `${validationError.msg}\n`;
                        }
                        if (validationError.loc && Array.isArray(validationError.loc)) {
                            errorMessage += `   Location: ${validationError.loc.join(' → ')}\n`;
                        }
                        if (validationError.type) {
                            errorMessage += `   Type: ${validationError.type}\n`;
                        }
                    });
                } else if (error.message) {
                    // Standard error message
                    errorMessage += `💬 ${error.message}`;
                } else {
                    // Generic error
                    errorMessage += '💬 An unexpected error occurred. Please try again.';
                }
                
                // Set the formatted error text
                botMessageDiv.style.whiteSpace = 'pre-wrap';
                botMessageDiv.textContent = errorMessage;
                
                console.log('🤖 Updated bot message div with error:', error);
            }
            
            if (responseMessage) {
                responseMessage.innerText = "Error submitting data.";
            }
        });
    }
    
    // Set up listeners after form is created
    setupFieldListeners();
    
    // Add event listener for AI Agent Send button (redundant but kept for compatibility)
    const aiAgentSendButton = document.getElementById('ai-agent-send');
    if (aiAgentSendButton) {
        aiAgentSendButton.addEventListener('click', function(event) {
            event.preventDefault();
            console.log('AI Agent Send button clicked');
            sendSimplifiedDataOnly();
            
            const responseMessage = document.getElementById("responseMessage");
            if (responseMessage) {
                responseMessage.innerText = "AI Agent processing...";
            }
        });
    } else {
        console.warn('AI Agent Send button (id: ai-agent-send) not found in DOM');
    }
    
    // Add a demo function to show simplified data capture
    function demonstrateSimplifiedCapture() {
        if (typeof captureSimplifiedData !== 'undefined') {
            const simplified = captureSimplifiedData();
            
            // Count fields with data-id
            const fieldsWithDataId = simplified.length;
            
            // Show breakdown by field type
            const fieldTypes = {};
            simplified.forEach(field => {
                fieldTypes[field.fieldType] = (fieldTypes[field.fieldType] || 0) + 1;
            });
            
            // Show fields with values
            const fieldsWithValues = simplified.filter(field => 
                field.fieldValue && field.fieldValue !== '');
        }
    }

    // Run demo after a short delay to ensure form is ready
    setTimeout(demonstrateSimplifiedCapture, 1000);
    
    // Make functions globally available for manual testing
    window.demonstrateSimplifiedCapture = demonstrateSimplifiedCapture;
    window.sendSimplifiedDataOnly = sendSimplifiedDataOnly;
    window.generateUUID = generateUUID;
});

