# Viva Questions & Answers

## Campus Lost and Found Management System Using AWS Cloud

> These answers are written in **beginner-friendly** language. Read them carefully before your viva.

---

### Q1. What is the purpose of your project?

**Answer:** Our project is a Campus Lost and Found Management System. It allows students to report lost and found items on campus, search for items, and view details. The key feature is the **collection verification** — when someone comes to collect a found item, an authorised organiser verifies their identity and records who collected it, who verified it, and when. This creates an **audit trail** so there's accountability for every item handover. The entire system runs on AWS serverless services, meaning we don't manage any physical servers.

---

### Q2. Why did you choose AWS serverless architecture?

**Answer:** We chose serverless for three reasons:
1. **Cost:** Lambda charges only when code runs (pay-per-use), so for a student project with occasional traffic, the cost is nearly zero.
2. **No server management:** We don't need to provision, patch, or maintain EC2 instances. AWS handles scaling automatically.
3. **Scalability:** If 100 students use it simultaneously, Lambda automatically creates more instances to handle the load.

The key services are Lambda (compute), DynamoDB (database), API Gateway (HTTP endpoints), S3 (file storage), and Cognito (authentication).

---

### Q3. Explain the architecture of your system.

**Answer:** The architecture has three layers:
1. **Frontend:** HTML, CSS, and JavaScript running in the browser. Hosted on S3 with CloudFront CDN for fast delivery.
2. **API Layer:** API Gateway receives HTTP requests and routes them to the correct Lambda function. It also validates JWT tokens for protected endpoints.
3. **Backend:** Lambda functions (written in Python) process requests and interact with DynamoDB (database) and S3 (image storage).

Data flows like this: Browser → API Gateway → Lambda → DynamoDB → Lambda → API Gateway → Browser.

---

### Q4. What is DynamoDB and why did you use it?

**Answer:** DynamoDB is a **NoSQL database** managed by AWS. Unlike SQL databases (like MySQL), it stores data as key-value pairs without fixed schemas. We chose it because:
- It's **fully managed** — AWS handles backups, scaling, and maintenance.
- It provides **fast reads** — single-digit millisecond latency.
- It has a **generous free tier** — 25 GB free storage.
- It supports **conditional writes** — essential for preventing duplicate collections.

Our `itemId` is the **partition key**, which means DynamoDB can fetch any item by its ID instantly without scanning the whole table.

---

### Q5. How do you prevent duplicate collections?

**Answer:** We use a DynamoDB **ConditionExpression**. When an organiser confirms a collection, the update command includes: `ConditionExpression: collectionStatus = PENDING`. This means:
- If the item is still PENDING → the update succeeds.
- If another organiser already collected it → DynamoDB **rejects** the update atomically.
- This works even if two organisers click "Confirm" at the exact same millisecond.

This is called an **optimistic lock** — instead of locking the record, we let the database check the condition at write time.

---

### Q6. How does authentication work in your system?

**Answer:** We use **Amazon Cognito** for authentication. Here's the flow:
1. The organiser enters their email and password.
2. Cognito validates the credentials and returns a **JWT token** (JSON Web Token).
3. The browser stores this token and sends it with every API request in the `Authorization` header.
4. API Gateway validates the JWT before forwarding the request to Lambda.
5. Lambda reads the organiser's identity (name, ID) from the JWT claims — not from user input.

This means even if someone inspects the JavaScript and tries to send a fake request, they can't pretend to be a different organiser because they don't have a valid JWT for that person.

---

### Q7. Why don't you derive the organiser identity from the form input?

**Answer:** This is a **critical security decision**. If we took the organiser name from a form field, anyone could open browser DevTools, change the field value, and pretend to be a different organiser. Instead, the organiser's identity comes from the **JWT token** which is cryptographically signed by Cognito. Lambda reads the `sub` (subject) and `name` claims from this verified token. This is the same approach used by banks and enterprise applications.

---

### Q8. What are pre-signed URLs and why do you use them?

**Answer:** A pre-signed URL is a temporary, time-limited URL that grants access to a specific S3 object. We use them because:
1. **Upload:** When a student wants to upload a photo, our Lambda generates a pre-signed URL. The browser uploads the file directly to S3 using this URL. The URL expires in 5 minutes.
2. **Download:** When someone views an item, Lambda generates a pre-signed URL for the image. This URL expires in 15 minutes.

The S3 bucket has **Block Public Access** enabled, so nobody can access images without a valid pre-signed URL. This keeps images private.

---

### Q9. What is API Gateway and what role does it play?

**Answer:** API Gateway is a managed service that acts as the "front door" for our backend. It:
1. **Receives** HTTP requests from the browser (GET, POST, etc.)
2. **Validates** JWT tokens for protected endpoints
3. **Routes** requests to the correct Lambda function
4. **Returns** the Lambda response to the browser
5. **Handles CORS** headers so browsers allow cross-origin requests
6. **Throttles** requests to prevent abuse

Without API Gateway, our Lambda functions would have no way to receive HTTP requests from the internet.

---

### Q10. What is the difference between your LOCAL mode and AWS mode?

**Answer:**
| Aspect | LOCAL Mode | AWS Mode |
|--------|-----------|----------|
| Data storage | Browser memory (resets on refresh) | DynamoDB (persistent) |
| Images | Data URL in memory | S3 with pre-signed URLs |
| Authentication | Hardcoded demo credentials | Cognito JWT tokens |
| API calls | Direct JavaScript function calls | HTTP requests via API Gateway |
| Collection records | In-memory array | DynamoDB append-only table |

The **Data Adapter Pattern** makes this possible. The frontend calls `DataAdapter.getItems()` without knowing whether it talks to `LocalAdapter` (memory) or `AwsAdapter` (API). We just swap the adapter.

---

### Q11. What is CloudWatch and how does it help?

**Answer:** CloudWatch is AWS's monitoring and logging service. Every time a Lambda function runs, it automatically sends logs to CloudWatch — including:
- Input received
- Errors encountered
- Print/console output
- Execution duration and memory used

If something goes wrong (e.g., a DynamoDB permission error), I can go to CloudWatch → Log Groups → find the Lambda's logs → see the exact error message. This is essential for troubleshooting.

---

### Q12. What is CloudTrail and how is it different from CloudWatch?

**Answer:**
- **CloudWatch** logs **application-level** events (Lambda execution, API calls, error messages).
- **CloudTrail** logs **AWS account-level** events (who created a DynamoDB table, who modified an IAM policy, who deleted a Lambda function).

CloudTrail answers: "Who made changes to our AWS infrastructure and when?" It's an audit trail for AWS management operations. Management events are logged for free. S3 data events (individual file uploads/downloads) cost extra and should not be enabled by default.

---

### Q13. What security measures have you implemented?

**Answer:** Eight key measures:
1. **No credentials in browser code** — AWS keys never appear in JavaScript
2. **JWT authentication** — Cognito tokens for organiser endpoints
3. **Server-side identity** — Organiser name from JWT, not form input
4. **Input sanitisation** — HTML tags stripped, field lengths limited
5. **Conditional writes** — DynamoDB prevents duplicate collections atomically
6. **Pre-signed URLs** — Time-limited access to private S3 images
7. **Block Public Access** — S3 bucket is private by default
8. **Least-privilege IAM** — Lambda role has only the permissions it needs

---

### Q14. What is the Data Adapter Pattern and why did you use it?

**Answer:** The Data Adapter Pattern is a design pattern where we create a **common interface** (`DataAdapter`) that hides the implementation details. Think of it like a universal power adapter — your laptop doesn't care whether it's plugged into an Indian socket or an American socket; the adapter handles the difference.

In our project, `DataAdapter.getItems()` works the same whether it calls `LocalAdapter` (browser memory) or `AwsAdapter` (API Gateway → Lambda → DynamoDB). This means we can develop and test the frontend without AWS, then switch to production by just changing a configuration file.

---

### Q15. What happens if two organisers try to collect the same item simultaneously?

**Answer:** DynamoDB handles this with **conditional writes**. The update command includes `ConditionExpression: collectionStatus = PENDING`:
- Organiser A's request arrives first → DynamoDB checks condition → PENDING ✓ → update succeeds → status becomes COLLECTED
- Organiser B's request arrives second → DynamoDB checks condition → COLLECTED ✗ → update fails → error returned: "Item has already been collected"

This is **atomic** — DynamoDB guarantees no race condition, even at the millisecond level. The organiser who succeeds gets a success message; the other gets a clear error.

---

### Q16. Explain the collection verification workflow end-to-end.

**Answer:**
1. A student reports a found item (public, no login needed)
2. The item appears on the dashboard with status "PENDING"
3. Later, the owner comes to collect the item
4. An authorised organiser logs in using Cognito credentials
5. The organiser opens the item's detail modal
6. The organiser enters the claimant's name (the owner who is collecting)
7. The system auto-fills the organiser's name and ID from their JWT token
8. The organiser clicks "Confirm Collection"
9. A confirmation dialog asks "Are you sure?"
10. Lambda performs a conditional update: only works if status is still PENDING
11. An append-only record is created in the CollectionHistory table
12. The item's status changes to "COLLECTED" on the dashboard
13. The collection history view shows who collected, who verified, and when

---

### Q17. What is IAM and what is "least privilege"?

**Answer:** IAM (Identity and Access Management) controls who can do what in AWS. The **principle of least privilege** means giving each component only the permissions it absolutely needs — nothing more.

Our Lambda role can:
- ✅ Read/write to our two DynamoDB tables
- ✅ Read/write objects in our S3 images bucket
- ✅ Write logs to CloudWatch

It cannot:
- ❌ Delete DynamoDB tables
- ❌ Access other AWS accounts
- ❌ Create new Lambda functions
- ❌ Access other S3 buckets

If a Lambda function is compromised, the damage is limited to only what it's allowed to do.

---

### Q18. Why did you choose Python for Lambda instead of Node.js?

**Answer:** Python was chosen because:
1. It's the most commonly taught language in colleges alongside DSA courses
2. The `boto3` library (AWS SDK for Python) is pre-installed in Lambda
3. Python code is concise and readable — easier to explain in a viva
4. Lambda supports Python 3.12 with excellent performance

Node.js would work equally well. The choice is mainly about familiarity and readability.

---

### Q19. What would you improve if you had more time?

**Answer:**
1. **Email notifications** — alert students when a matching item is found using Amazon SES
2. **AI image matching** — use Amazon Rekognition to compare photos of lost and found items
3. **Real-time updates** — use WebSockets (API Gateway WebSocket API) so the dashboard updates live
4. **Mobile app** — build a native app using React Native
5. **Full-text search** — add Amazon OpenSearch for better search capabilities
6. **Analytics dashboard** — show trends like most-lost categories, peak hours, etc.

---

### Q20. What is CORS and why is it needed?

**Answer:** CORS (Cross-Origin Resource Sharing) is a browser security feature. By default, JavaScript in a browser can only make requests to the **same domain** it was loaded from. If our frontend is on `example.com` but the API is on `api-gateway.amazonaws.com`, the browser blocks the request.

CORS headers tell the browser: "It's okay, I allow requests from this other domain." Our Lambda functions include `Access-Control-Allow-Origin: *` in their responses, which means any domain can call the API. In production, you'd restrict this to your specific domain.

---

## Bonus Tips for Your Viva

1. **Open the app and demo it live** — professors love seeing working projects
2. **Show the collection workflow end-to-end** — this is your unique feature
3. **Explain the security measures** — shows depth of understanding
4. **Mention the Data Adapter Pattern** — shows software engineering knowledge
5. **If asked something you don't know**, say "That's a great question. Based on my understanding of the architecture, I think..." and reason through it
