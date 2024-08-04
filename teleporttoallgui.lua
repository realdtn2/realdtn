local savedPosition = nil  -- Variable to store the saved position

-- Function to create the GUI
local function createGUI()
    -- Check if the GUI already exists and remove it if so
    local existingGUI = game.Players.LocalPlayer.PlayerGui:FindFirstChild("CommandGUI")
    if existingGUI then
        existingGUI:Destroy()
    end

    -- Create the GUI
    local ScreenGui = Instance.new("ScreenGui")
    ScreenGui.Name = "CommandGUI"
    ScreenGui.Parent = game.Players.LocalPlayer:WaitForChild("PlayerGui")

    local Frame = Instance.new("Frame")
    Frame.Size = UDim2.new(0, 200, 0, 100)
    Frame.Position = savedPosition or UDim2.new(0, 10, 0, 10)  -- Use saved position if available
    Frame.BackgroundColor3 = Color3.fromRGB(50, 50, 50)
    Frame.Parent = ScreenGui

    local Button = Instance.new("TextButton")
    Button.Size = UDim2.new(0, 180, 0, 50)
    Button.Position = UDim2.new(0, 10, 0, 10)
    Button.Text = "Teleport Player"
    Button.BackgroundColor3 = Color3.fromRGB(100, 100, 100)
    Button.Parent = Frame

    -- Define the command function
    loadstring([[
        local function addcmd(name, params, func)
            -- Mock implementation of adding the command
            _G.commands = _G.commands or {}
            _G.commands[name] = {params = params, func = func}
        end

        local function getPlayer(name, speaker)
            -- Mock implementation of getting the player
            local players = {}
            for _, player in pairs(game.Players:GetPlayers()) do
                if player.Name:lower() == name:lower() then
                    table.insert(players, player)
                end
            end
            return players
        end

        local function getRoot(character)
            -- Mock implementation of getting the root part
            return character:FindFirstChild("HumanoidRootPart") or character.PrimaryPart
        end

        local function execCmd(command)
            -- Mock implementation of executing a command
            print("Executing command:", command)
        end

        -- Register the 'goto' command
        addcmd('goto', {'to'}, function(args, speaker)
            local players = getPlayer(args[1], speaker)
            for i, v in pairs(players) do
                if v.Character ~= nil then
                    if speaker.Character:FindFirstChildOfClass('Humanoid') and speaker.Character:FindFirstChildOfClass('Humanoid').SeatPart then
                        speaker.Character:FindFirstChildOfClass('Humanoid').Sit = false
                        wait(0.1)
                    end
                    getRoot(speaker.Character).CFrame = getRoot(v.Character).CFrame + Vector3.new(3, 1, 0)
                end
            end
            execCmd('breakvelocity')
        end)
    ]])()

    -- Function to handle button click
    local function onButtonClick()
        -- Get the Players service
        local Players = game:GetService("Players")

        -- Get the list of all players
        local allPlayers = Players:GetPlayers()

        -- Create a temporary list to store players
        local tempList = {}

        -- Loop through the list and add each player to the temporary list
        for _, player in ipairs(allPlayers) do
            table.insert(tempList, player)
        end

        -- Execute the command for each player
        print("Players in tempList:")
        for _, player in ipairs(tempList) do
            -- Execute the command
            local command = _G.commands['goto']
            if command then
                command.func({player.Name}, game.Players.LocalPlayer)
                wait(0.08) -- Time between teleporting
            end
        end
    end

    -- Connect the button click event
    Button.MouseButton1Click:Connect(onButtonClick)

    -- Make the Frame draggable
    local dragging = false
    local dragStart = nil
    local startPos = nil

    local function updateDrag(input)
        local delta = input.Position - dragStart
        Frame.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
    end

    Frame.InputBegan:Connect(function(input)
        if input.UserInputType == Enum.UserInputType.MouseButton1 then
            dragging = true
            dragStart = input.Position
            startPos = Frame.Position
            input.Changed:Connect(function()
                if input.UserInputState == Enum.UserInputState.End then
                    dragging = false
                    savedPosition = Frame.Position  -- Save the position when dragging ends
                end
            end)
        end
    end)

    Frame.InputChanged:Connect(function(input)
        if dragging and input.UserInputType == Enum.UserInputType.MouseMovement then
            updateDrag(input)
        end
    end)
end

-- Create the GUI when the player character is added
game.Players.LocalPlayer.CharacterAdded:Connect(createGUI)

-- Also create the GUI if the player is already in the game (initial run)
if game.Players.LocalPlayer.Character then
    createGUI()
end
