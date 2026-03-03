# 🌸 Bloom Cafe POS

![Bloom Cafe Logo](logo.png)

A modern, feature-rich Point of Sale (POS) system designed for Bloom Cafe. Built with Electron.js, this desktop application provides a complete solution for managing sales, inventory, and menu items with an intuitive and warm "Modern Trattoria" themed interface.

## ✨ Key Features

*   **Intuitive Sales Interface**: Easily browse categories and products to add items to the cart.
*   **Advanced Cart Management**: Support for product add-ons, quantity adjustments, and a clear summary of the current order.
*   **Comprehensive Billing System**: Generate detailed bill previews, record payment modes (Cash, UPI, Card), and save sales data for reporting.
*   **Powerful Analytics Dashboard**:
    *   View total revenue and number of bills for any selected date.
    *   Identify **Top Selling Products** to understand customer preferences.
    *   Analyze **Sales by Category** to see which parts of your menu are most profitable.
    *   Track **Payment Mode Distribution**.
    *   Get real-time alerts for **Low-Stock Items**.
*   **Full Menu Management**:
    *   Create and delete product categories.
    *   Add, edit, and remove products.
    *   Manage complex orders by adding or removing **add-ons** (like extra cheese or toppings) from products.
*   **Simple Inventory Control**:
    *   Track stock levels for all inventory items.
    *   Set low-stock alert thresholds.
    *   Manually add new items to the inventory.
*   **Persistent Data Storage**: All menu, inventory, and sales data is stored locally in JSON files, ensuring your data is safe and accessible.

## 📸 Screenshots

*(Placeholder: I recommend adding screenshots of the main POS screen, the dashboard, and the management modals here to showcase the application.)*

## 💻 Tech Stack

*   **Framework**: [Electron.js](https://www.electronjs.org/)
*   **Frontend**: HTML5, CSS3, JavaScript
*   **Backend**: [Node.js](https://nodejs.org/)
*   **Packaging**: [electron-builder](https://www.electron.build/)
*   **Data Storage**: Local JSON files

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

You need to have [Node.js](https://nodejs.org/en/download/) and npm (which comes with Node.js) installed on your system. You can verify your installation by running:

```bash
node -v
npm -v
```

### Installation Guide

1.  **Clone the repository**
    Open your terminal or command prompt and clone the project from GitHub:
    ```bash
    git clone <YOUR_REPOSITORY_URL>
    cd bloom-cafe-pos
    ```
    *(Note: Replace `<YOUR_REPOSITORY_URL>` with the actual URL of your GitHub repository.)*

2.  **Install dependencies**
    Once inside the project directory, run the following command to install all the necessary packages defined in `package.json`:
    ```bash
    npm install
    ```

3.  **Run the application**
    After the installation is complete, you can start the application in development mode:
    ```bash
    npm start
    ```
    This will launch the Bloom Cafe POS application.

## 📦 Building for Production

To create a distributable installer for your application (e.g., a `.exe` for Windows or a `.dmg` for macOS), you can use the build script.

### For Windows

Run the following command to build a Windows installer. The output will be located in the `dist/` folder.

```bash
npm run build -- --win
```

### For macOS

Run the following command to build a macOS application. The output will be located in the `dist/` folder.

```bash
npm run build -- --mac
```

---
*This README was generated to provide a comprehensive guide for the Bloom Cafe POS software.*
