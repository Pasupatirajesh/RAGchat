const fetchDocuments = async () => {
    const response = await fetch("https://supabase.co", {
      method: "POST",
      headers: {
        "Authorization": `Bearer SB_KEY`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "My New Document",
        content: "This is a test document",
      }),
    });
  
    if (!response.ok) {
      console.error("Error:", response.status, await response.text());
    } else {
      const data = await response.json();
      console.log("Document created:", data);
    }
  };
  