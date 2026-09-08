Requirements:
1. Website for Global AI Manila
   - Logo is in root directory GlobalAIManila.png
2. The website should have the following pages:
   - Home
   - About Us
   - Events
   - Contact Us
3. Administrators
   - Create events on the Events page.
   - Approve or reject users registering for events.
4. User
   - Create a profile on the website with their name, email, and a short bio.
   - Submit inquiries through a contact form on the Contact Us page.
   - Register for events through a registration form on the Events page.
5. Save data in an Azure Cosmos database.
   - Events
   - Event Registrations
   - User Profiles
6. Deploy website and Azure Cosmos database to Azure cloud platform.
   - Resource Group: GlobalAIManila
   - App Service Plan: GlobalAIManilaPlan
   - Web App: GlobalAIManilaWebApp
   - Azure Cosmos DB: GlobalAIManilaDB
   - Use the cheapest pricing tier available for both the App Service Plan and Azure Cosmos DB.
   - Create Github Action workflow to automatically deploy the website to Azure when changes are pushed to the main branch of the repository.
   - Create the needed resources in Azure.
   - Maintain code in GitHub repository.