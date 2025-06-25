# **Akka Component Diagram Generator for VSCode**

This VSCode extension scans your Java project for Akka SDK components and generates an interactive, visual diagram of their relationships. It's designed to help you quickly understand the architecture of your Akka SDK services.

![diagram](example-component-diagram.png)

## **Features**

* **Automatic Component Detection**: Scans your source code to find Akka SDK components like Endpoints, Entities, Views, Consumers, Workflows, and more.
* **Interactive Diagram**: Renders components as nodes and their interactions as labeled edges in a dedicated editor tab.
* **Manual Layout with Persistence**: Manually arrange the diagram by dragging nodes. Your custom layout, pan, and zoom settings are saved and restored between sessions.
* **Click-to-Navigate**: Simply click on any component node in the diagram to instantly open the corresponding source file and jump to the class definition.
* **Scoped Scans**: Right-click on any folder in the VSCode File Explorer to generate a diagram for just that part of your project.
* **Detailed Interaction Tooltips**: Hover over the connection lines between components to see a detailed list of the specific methods being invoked.

## **Installation**

Currently, the extension is distributed via a .vsix file available on the project's GitHub releases page.

1. Go to the [Releases Page](https://github.com/mckeeh3/akka-component-diagram-vscode-extension/releases).
2. Download the latest .vsix file.
3. In VSCode, open the **Extensions** view from the side bar.
4. Click the "More Actions" (**...**) button at the top of the Extensions view.
5. Select **Install from VSIX...** and choose the .vsix file you downloaded.
6. Reload VSCode when prompted.

## **How to Use**

The primary way to use the extension is through the File Explorer context menu.

1. Open your Akka-based Java project in VSCode.
2. In the **File Explorer** side panel, right-click on the folder (e.g., your main java source root) that you want to visualize.
3. Select **Akka: Generate Component Diagram** from the context menu.
4. A new editor tab will open, displaying the interactive component diagram.

### **Interacting with the Diagram**

* **Navigate to Code**: Left-click on any component node.
* **Pan the View**: Middle-click and drag the diagram's background.
* **Zoom the View**: Use the mouse wheel.
* **Rearrange Layout**: Left-click and drag any component node to a new position. The layout is saved automatically.

## **License**

This extension is open source and available under the [MIT License](http://docs.google.com/LICENSE.md).
