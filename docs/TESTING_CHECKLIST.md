# Testing Checklist

## Campus Lost and Found Management System

Use this checklist to verify every feature works before your demo.

---

## A. Local Demo Mode Testing

### 1. Dashboard
- [ ] Page loads without JavaScript errors (check browser Console)
- [ ] Summary cards show correct counts (Total, Lost, Found, Collected)
- [ ] Item cards display with photos, names, categories, and status badges
- [ ] Cards have staggered fade-in animation
- [ ] "PENDING" badge shows in orange, "COLLECTED" in green
- [ ] "LOST" badge shows in red, "FOUND" in blue
- [ ] Empty state message shows when all items are filtered out

### 2. Search & Filters
- [ ] Typing in search bar filters items by name (real-time)
- [ ] Category dropdown filters items correctly
- [ ] Status filter (All, Lost, Found) works
- [ ] Collection status filter (All, Pending, Collected) works
- [ ] Combining search + filters works together
- [ ] Clearing filters shows all items again

### 3. Report Lost Item
- [ ] "Report Lost Item" button opens the form
- [ ] All fields are required (form validation works)
- [ ] Category dropdown is populated
- [ ] Date picker defaults to today
- [ ] Image upload accepts JPEG, PNG, WebP
- [ ] Image preview shows after selecting a file
- [ ] Submitting creates a new item on the dashboard
- [ ] New item appears at the top of the list
- [ ] Success toast notification appears
- [ ] Form resets after successful submission

### 4. Report Found Item
- [ ] "Report Found Item" button opens the form
- [ ] Typing in "Item Name" shows suggestions from existing lost items
- [ ] Selecting a suggestion auto-fills category and description
- [ ] "Matched to lost item" banner appears when a suggestion is selected
- [ ] Can still type a custom name without selecting a suggestion
- [ ] Submit creates a FOUND item with correct data
- [ ] All validations work the same as Lost form

### 5. Item Detail View
- [ ] Clicking an item card opens the detail modal
- [ ] All item information displays correctly
- [ ] Photo shows in the modal
- [ ] Close button (×) works
- [ ] Clicking outside the modal closes it

### 6. Organiser Login
- [ ] "Organiser Login" button is visible in the navigation
- [ ] Login form appears with username and password fields
- [ ] Demo credentials hint is shown (admin@campus.edu / demo123)
- [ ] Wrong credentials show error message
- [ ] Correct credentials log in successfully
- [ ] Organiser name and "Logout" button appear after login
- [ ] Collection verification section becomes visible

### 7. Collection Verification
- [ ] After login, item detail modal shows "Confirm Collection" section
- [ ] Claimant name field is required
- [ ] Organiser name and ID are auto-filled (not editable)
- [ ] Clicking "Confirm Collection" shows a confirmation dialog
- [ ] Confirming changes item status to "COLLECTED"
- [ ] Dashboard card updates to show green "COLLECTED" badge
- [ ] Trying to collect an already-collected item shows error
- [ ] Collection record appears in the History view

### 8. Collection History
- [ ] History view/table shows all collection records
- [ ] Each record shows: item name, claimant, organiser, date
- [ ] Demo records are labelled as demo data
- [ ] New collections appear in history immediately

### 9. Responsive Design
- [ ] Resize browser to mobile width — layout adapts
- [ ] Navigation collapses to mobile menu
- [ ] Cards stack vertically on narrow screens
- [ ] Forms are usable on mobile
- [ ] Modal is scrollable on small screens

---

## B. AWS Mode Testing (After Deployment)

### 10. Configuration
- [ ] Created `js/env.js` from `js/env.example.js`
- [ ] Console shows "[Config] AWS mode activated"
- [ ] Console shows "[DataAdapter] Using AwsAdapter adapter"

### 11. DynamoDB
- [ ] Creating an item stores it in DynamoDB (check AWS console)
- [ ] Refreshing the page still shows the item (data persists)
- [ ] Filters and search work with live data

### 12. S3 Image Upload
- [ ] Uploading a photo generates a pre-signed URL
- [ ] Image appears in the S3 bucket (check AWS console)
- [ ] Image displays correctly in item cards and detail view
- [ ] S3 bucket Block Public Access is still ON

### 13. Cognito Authentication
- [ ] Login with real Cognito credentials works
- [ ] Wrong credentials show appropriate error
- [ ] JWT token is sent in API requests (check Network tab)
- [ ] Collection confirmation requires valid token (401 without it)

### 14. Collection Security
- [ ] Organiser name/ID in collection record matches Cognito identity
- [ ] Cannot fake organiser identity via browser DevTools
- [ ] Duplicate collection attempt returns error
- [ ] Collection history records are append-only

### 15. CloudWatch & CloudTrail
- [ ] Lambda logs appear in CloudWatch → Log Groups
- [ ] CloudTrail shows management events (DynamoDB table creation, etc.)

---

## C. Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Page is blank | Check browser console for JS errors |
| "AWS mode" but API fails | Verify `env.js` has correct API URL |
| CORS error | Re-enable CORS on API Gateway and redeploy |
| Images don't load | Check S3 CORS configuration |
| Login fails in AWS | Verify Cognito user exists and email is verified |
| Collection fails | Check Lambda has DynamoDB permissions |
| 403 on API | Redeploy API Gateway to `prod` stage |

